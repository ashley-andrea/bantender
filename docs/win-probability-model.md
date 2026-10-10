# Win-probability model: plan

Status: pipeline (steps 1-4, `make winprob`) and integration into the API (step 5) implemented; the UI for the "Offer options" step (step 7) is next. Code is in `backend/app/winprob/`.

## 1. Purpose

For a tender we are pricing, estimate the probability that the client accepts our offer, **as a function of the offer**. The estimate is learned from our historical bids.

For each tender the model returns a **full curve**, computed in one pass, covering the range of offers we could make. At each point it gives:

- the offer (CHF) and the resulting margin
- the win probability, with an uncertainty band
- the expected profit

The UI uses the curve for a slider. The three bid scenarios (Aggressive / Target / Conservative) are read from it. Explainability shows which features drive the probability, both overall and for this tender.

## 2. Scope of this task

- **Build:**
  - the model structure: data loading and validation, feature pipeline, training, evaluation
  - the curve and scenarios
  - explainability
  - integration into the pricing result and the API
- **Not in scope: the real dataset.** It is generated separately and delivered as two CSV files following the data contract in §4. Until it arrives, tests use a small synthetic fixture generated inside the tests (§12).
- **Split of work:** a teammate builds the dataset; this task is the training and testing pipeline (steps 1-4) and its integration into the API (step 5, `service.py`). The UI is built separately against the contract in §10.4.
- **Demo data:** until the real CSVs arrive, `demo_data.py` generates a synthetic history (used by `make winprob` and the tests). `synthetic.py` is the teammate's area; leave it untouched.
- **Run:** `make winprob` trains, evaluates and prints metrics, feature relevance, the curve, the scenarios and the per-tender explanation. It uses `data/reference/v2/historical_bids.csv` when present, otherwise the demo history. Outputs go to `backend/benchmarks/results/winprob/` (`report.json`, `curve.csv`).

## 3. Existing code to know

| What | Where | Notes |
| --- | --- | --- |
| Placeholder win model (linear, from Equans) | `app/pricing/scenarios.py::win_probability` | Used as the **fallback**. Must not change. |
| Placeholder bid scenarios | `app/pricing/scenarios.py::bid_scenarios` | A golden test pins its results. Must keep passing. |
| Parameters | `data/reference/v2/project_parameters.json` | `commercial.target_margin_pct`, `commercial.round_to_chf`; add a `win_model` section (§10.3) |
| Price formula | `app/pricing/engine.py::build_project`, `round_up` | `offer = baseline / (1 − margin)`; `baseline` is our full cost (direct + risk + overhead) |
| Pricing result | `app/pricing/service.py::price_tender` | Add a new key `win_curve`; leave existing keys unchanged |
| Award rule from the tender | `app/parsing/tender_info.py::parse_award` | `weight` (price points) and `zero_at_ratio`, or `None` |
| Trade from the tender | `app/parsing/tender_info.py::parse_project` | `project.bkp`, e.g. `"244"` |
| Reference data loaded at import | `app/api/main.py` | Train the win model at the same moment |
| AI config | `app/config.py` | `ai_provider`, `openai_model`, `openai_budget_usd` |
| Tests | `backend/tests/`, `make test` | Offline, a few seconds, no OpenAI calls |

## 4. Data contract

The dataset is delivered as two CSV files in `data/reference/v2/`. Validate the files on load and fail with a clear message if a column is missing or a value is out of range.

### 4.1 `historical_bids.csv`: one row per past bid

About 2,000 rows covering about 3 years.

| Column | Type / allowed values | Role |
| --- | --- | --- |
| `bid_id` | str, unique | id |
| `bid_date` | ISO date | validation split only; **not a feature** |
| `bkp_trade` | `242` heat generation, `243` heat distribution, `244` ventilation, `245` air conditioning, `246` refrigeration, `250` plumbing | feature (categorical) |
| `building_type` | `school`, `hospital`, `office`, `residential`, `industrial`, `public_building` | feature (categorical) |
| `canton` | Swiss canton code, e.g. `ZH`, `AG`, `BE` | feature (categorical) |
| `client_type` | `municipality`, `canton`, `federal`, `private` | feature (categorical) |
| `procedure` | `open`, `invited` | feature (categorical) |
| `market_reference_chf` | float > 0, the client's cost estimate | gives `price_position`; `log(market_reference_chf)` is a feature |
| `n_lots` | int ≥ 1 | feature (numeric) |
| `price_weight_pct` | float 0–100, price points in the award rule | gives `price_sensitivity` |
| `zero_at_ratio` | float > 1, the offer ratio at which price scores 0 points | gives `price_sensitivity` |
| `n_bidders` | int ≥ 1 | feature (numeric, log) |
| `competitive_intensity` | float 1–5 | feature (numeric) |
| `strategic_appetite` | float 1–5 | feature (numeric) |
| `available_capacity_pct` | float 0–100 | feature (numeric) |
| `incumbent_present` | 0/1 | feature (numeric) |
| `prior_wins_with_client` | int ≥ 0 | feature (numeric, capped at 3) |
| `technical_score_expected` | float 1–5 | feature (numeric) |
| `baseline_cost_chf` | float > 0, our full cost | **not a feature** (only for analysis) |
| `margin_pct` | float | **not a feature** (only for analysis) |
| `bid_price_chf` | float > 0, our offer | gives `price_position` |
| `won` | 0/1 | **target** |

Missing award rule: `price_weight_pct` and `zero_at_ratio` may be empty when the tender stated no rule.

### 4.2 `market_snapshots.csv`: one row per manual update of market data

| Column | Type |
| --- | --- |
| `snapshot_date` | ISO date |
| `competitive_intensity` | float 1–5 |
| `strategic_appetite` | float 1–5 |
| `available_capacity_pct` | float 0–100 |

This data does not come from the tender; someone updates it periodically. For a **new** tender, the latest snapshot gives the default values of these three features, and the estimator can change them for that tender. The history already stores the values that applied to each bid.

## 5. Features

Derived features (computed the same way for training and prediction, in one function in `schema.py` or `model.py`):

| Feature | Definition |
| --- | --- |
| `price_position` | `bid_price_chf / market_reference_chf` |
| `price_sensitivity` | `price_weight_pct / ((zero_at_ratio − 1) × 100)`: price points lost per 1 % above the lowest offer (e.g. 60 points, 0 at 150 % → 1.2). If the rule is missing: the training mean. |
| `price_position_x_sensitivity` | `(price_position − 1) × price_sensitivity` |
| `log_market_reference` | `log(market_reference_chf)` |
| `log_n_bidders` | `log(n_bidders)` |
| `prior_wins_capped` | `min(prior_wins_with_client, 3)` |

Model inputs:

- **Categorical:** `bkp_trade`, `building_type`, `canton`, `client_type`, `procedure`
- **Numeric:** `price_position`, `price_position_x_sensitivity`, `price_sensitivity`, `log_market_reference`, `n_lots`, `log_n_bidders`, `competitive_intensity`, `strategic_appetite`, `available_capacity_pct`, `incumbent_present`, `prior_wins_capped`, `technical_score_expected`

**Never inputs:** `bid_id`, `bid_date`, `margin_pct`, `baseline_cost_chf`, `bid_price_chf` (except through `price_position`), `won`.

Price enters **only** through `price_position` and `price_position_x_sensitivity`. The offer therefore matters more when the award rule weights price more.

## 6. Model

### 6.1 Pipeline

scikit-learn, installed as the optional extra `winprob` in `backend/pyproject.toml`. Import it in a guarded way so the API runs without it (§11).

```
Pipeline([
  ("features", ColumnTransformer([
      ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
      ("num", StandardScaler(), NUMERIC),
  ])),
  ("clf", LogisticRegression(max_iter=1000)),
])
```

- Default regularization. Fixed `random_state` wherever one applies.
- `handle_unknown="ignore"`: a category not seen in training (e.g. a new canton) contributes nothing.
- The learned weights decide which features matter. Features without a real effect should end up with weights near zero. Explainability (§9) reports this, and the model must not be built to favour any feature.

### 6.2 Training and evaluation

- **`train(history, snapshots)`** fits on all rows and returns a `LogisticWinModel`. Its `version` is `"logreg-" + the first 8 characters of the SHA-256 of the history CSV`.
- **`evaluate(history)`:**
  - Time-based split: the last 6 months of `bid_date` are the test set; everything before is the training set.
  - Reports **AUC, Brier score, log loss and 10-bin calibration** on the test set.
  - Reports the same metrics for the placeholder model on the same rows, for comparison.

  The results go into the model summary (§10.4).

### 6.3 Monotonicity

A higher offer must never raise the win probability. After fitting, check on the raw feature scale that the derivative of the logit with respect to `price_position` is negative for every `price_sensitivity` in the training range:

```
d logit / d price_position = w_pp / sd_pp + w_int × sensitivity / sd_int < 0
```

Here `w` are the fitted weights and `sd` the scaler's standard deviations. Check both ends of the range. If the check fails, reject the model and use the fallback (§11).

### 6.4 Uncertainty band

The band is an 80 % band per curve point, from the Laplace approximation:

- Covariance of the weights: `Σ = H⁻¹`, where `H` is the Hessian of the fitted objective on the transformed training matrix, with the intercept column included:
  - `H = C · Xᵀ W X + P`
  - `W = diag(p (1 − p))`
  - `P` is the identity, with 0 for the intercept
- Logit variance at a point `x`: `xᵀ Σ x`.
- Band: `σ(logit ± 1.2816 × sd)`.

This is computed with numpy, which comes with scikit-learn.

## 7. Prediction for a new tender

### 7.1 `TenderContext` (pydantic model in `schema.py`)

It holds every feature input except the offer:

| Inputs | Source for the current tender |
| --- | --- |
| `bkp_trade`, `price_weight_pct`, `zero_at_ratio`, `n_lots` | parser (`project.bkp`, `award`, `lots`) |
| `building_type`, `canton`, `procedure` | parser where possible (project name words, postal code, procedure text); otherwise the fixture |
| `market_reference_chf`, `client_type`, `n_bidders`, `incumbent_present`, `prior_wins_with_client`, `technical_score_expected` | ingestion; for the demo, `data/samples/oberglatt/tender_context.json` |
| `competitive_intensity`, `strategic_appetite`, `available_capacity_pct` | latest market snapshot |

- Any of these values can be overridden by estimator settings (`settings["win_context"]`).
- **Market reference missing:** use our price at the target margin, `baseline / (1 − target_margin_pct / 100)`, and report `market_reference_source: "target_margin_fallback"`. Otherwise report `"ingestion"`.

### 7.2 Model interface

```python
class WinModel(Protocol):
    name: str      # "ml" | "placeholder"
    version: str
    def predict(self, offers: np.ndarray, context: TenderContext) -> np.ndarray: ...      # p per offer
    def predict_band(self, offers: np.ndarray, context: TenderContext) -> tuple[np.ndarray, np.ndarray]: ...
```

- **`PlaceholderWinModel`** wraps `app/pricing/scenarios.py::win_probability`, with reference = our price at the target margin. It is the same formula as today and has no band: `low = high = p`.

## 8. Curve and scenarios (`curve.py`)

### 8.1 Curve

- **Grid:** margin from 0 % to 20 % in 0.1 % steps (201 points).
- **Each point:**
  - `offer = baseline / (1 − margin)`, exact (not rounded)
  - `price_position = offer / market_reference`
  - `win_probability`, `p_low`, `p_high`
  - `expected_profit = win_probability × (offer − baseline)`

All points come from one vectorized `predict` call.

### 8.2 Scenarios

Computed from the curve, using only points with margin ≥ `min_margin_pct` (2 %):

| Scenario | Definition |
| --- | --- |
| **Target** | The point with the highest expected profit |
| **Aggressive** | The lowest offer whose expected profit is ≥ `near_optimal_share` (90 %) of the Target's |
| **Conservative** | The highest offer whose expected profit is ≥ 90 % of the Target's |

- Each scenario's offer is rounded up to `round_to_chf` with `engine.round_up`. Then its margin, probability and expected profit are recomputed at the rounded offer.
- The output order is always Aggressive ≤ Target ≤ Conservative.

## 9. Explainability (`explain.py`)

- **Global (model summary):** feature relevance on the held-out set, using permutation importance (`sklearn.inspection.permutation_importance`, log loss, fixed seed). Categorical features are grouped back to their original column. Report every feature, ranked, with its importance and the sign of its effect.
- **Per tender, at the Target offer:** the contribution of each feature to the logit, `weight × (transformed value − training mean of the transformed value)`, summed per original feature and converted to percentage points against the average tender. Ranked by absolute size.
  - Output: `[{feature, value, pts}]`
  - Example: "price position 1.03: −6 pts · building type school: +5 pts · competitive intensity 4: −4 pts".
- **Optional, off by default:** a plain-language OpenAI summary of the curve, budget-capped, only when `ai_provider != "off"`. Send only curve numbers and non-sensitive tender facts, never costs, catalogue, baseline or history. No OpenAI calls in tests.

## 10. Integration

### 10.1 Service (`service.py`)

`get_win_model(history_csv, snapshots_csv, params, mode)`:

1. loads and validates the CSVs
2. trains and checks monotonicity
3. evaluates
4. returns the model plus its summary

It is called once at import in `app/api/main.py`.

### 10.2 Config

`WIN_MODEL=ml | placeholder` in `app/config.py` (default `ml`). Paths for the two CSVs default to `data/reference/v2/`.

### 10.3 Parameters

Add to `project_parameters.json`:

```json
"win_model": {
  "margin_grid_pct": {"start": 0.0, "stop": 20.0, "step": 0.1},
  "near_optimal_share": 0.9,
  "min_margin_pct": 2.0,
  "band": 0.8
}
```

Extend `app/reference/models.py` with the matching pydantic model.

### 10.4 Output

`price_tender` gets a new key `win_curve` (every pricing response: GET pricing, line edits, PATCH settings). The existing `scenarios` key is unchanged. Example for the full Oberglatt tender (values rounded):

```json
{
  "model": "ml",                        // ml | placeholder | unavailable | error
  "model_version": "logreg-ab608985",
  "reason": null,                       // why the placeholder / nothing is used, else null
  "baseline": 2325198,                  // our full cost (pricing engine, follows every edit)
  "market_reference_chf": 2530000,
  "market_reference_source": "demo_fixture",   // demo_fixture | estimator | target_margin_fallback
  "context": {"bkp_trade": "244", "building_type": "school", "n_bidders": 6, "...": "..."},
  "sources": {"bkp_trade": "tender", "competitive_intensity": "market_snapshot", "n_bidders": "demo_fixture", "...": "..."},
  "snapshot_date": "2026-07-01",
  "parameters": {"margin_grid_pct": [0, 20, 0.1], "near_optimal_share": 0.9, "min_margin_pct": 2.0, "band": 0.8, "round_to_chf": 1000},
  "points": [                           // 201 points, margin 0-20 % in 0.1 % steps, exact (unrounded) offers
    {"margin_pct": 8.0, "offer": 2527389, "price_position": 0.999,
     "win_probability": 0.168, "p_low": 0.133, "p_high": 0.211, "expected_profit": 34014}
  ],
  "scenarios": [                        // offers rounded up to round_to_chf
    {"name": "Aggressive", "offer": 2453000, "margin_pct": 5.2, "win_probability": 0.240, "expected_profit": 30676},
    {"name": "Target", "offer": 2528000, "margin_pct": 8.0, "win_probability": 0.168, "expected_profit": 34013},
    {"name": "Conservative", "offer": 2619000, "margin_pct": 11.2, "win_probability": 0.105, "expected_profit": 30730}
  ],
  "current": {"offer": 2461000, "margin_pct": 5.5, "win_probability": 0.231, "p_low": 0.186, "p_high": 0.284, "expected_profit": 31424},
  "explanation": [                      // at the Target offer, points vs the average tender, largest first ([] for the placeholder)
    {"feature": "bkp_trade", "value": "244", "pts": 11.1},
    {"feature": "price_position_x_sensitivity", "value": -0.001, "pts": -6.7}
  ]
}
```

`shap` (learned model only, else `null`): exact SHAP values in log-odds, `{"base": -1.2, "fixed": {"bkp_trade": 0.55, …}, "per_point": ["shap_price_position", "shap_price_position_x_sensitivity"]}`. For a linear model with the training set as background, SHAP_j = w_j · (x_j − mean_j); one-hot columns are summed per feature. Only the two price features change with the offer, so their values are on each point under the `per_point` keys. `base + Σ fixed + Σ per-point = logit(win_probability)` at every point. The "Key drivers" chart shows each feature's share |SHAP| ÷ Σ|SHAP| at the slider position, the top 5 plus "Other factors".

Input sources: `tender` (parser: trade, building type from the project name, award rule, number of lots) · `market_snapshot` (latest row of `market_snapshots.csv`) · `demo_fixture` (`tender_context.json`, stand-in for the ingestion pipeline; its values, including the client estimate of CHF 2.53 M, are demo data) · `estimator` (overrides).

How the UI uses it:

- **Slider:** read `points` client-side (no request while sliding).
- **Apply an offer** (a scenario or a slider position): `PATCH /api/tenders/{id}/settings {"margin_pct": <margin_pct>}`. The selling price becomes that offer; the new response carries the updated `current`.
- **Correct an input** (e.g. bidders, client estimate): `PATCH /api/tenders/{id}/settings {"win_context": {"n_bidders": 4}}`. Keys are the `TenderContext` fields; unknown or invalid values return 400. The current overrides are echoed in `settings.win_context`.

`GET /api/win-model` returns the model summary: model and version, reason, rows, date range, win rates, held-out metrics (model vs placeholder), calibration, monotonicity, global feature relevance (§9), the latest market snapshot and the `win_model` parameters.

## 11. Fallback

Use `PlaceholderWinModel` when any of these holds:

- `WIN_MODEL=placeholder`
- scikit-learn is not installed
- the history CSV is missing or invalid
- training fails
- the monotonicity check fails

The curve and scenarios are then computed the same way, `win_curve.model` is `"placeholder"`, and the summary states the reason. The API must start and price tenders in every case.

## 12. Tests (`backend/tests/test_winprob.py`)

- **Fixture:** a small synthetic history (e.g. 600 rows, fixed seed) generated in `conftest.py`, following the data contract. The fixture should include:
  - a clear negative price effect, stronger with higher price sensitivity
  - a few features with real effects
  - a couple of features with no effect

  This is only to test the code. Its formula is not the real dataset.
- **Data:** validation rejects a missing column and an out-of-range value.
- **Model:**
  - trains deterministically (same data → same weights)
  - the monotonicity check passes
  - test AUC on the fixture ≥ 0.70
  - beats the placeholder's log loss on the fixture
  - no-effect features rank below the real ones in permutation importance
- **Curve:**
  - 201 points
  - probability non-increasing in the offer, for many random contexts
  - `p_low ≤ p ≤ p_high`
- **Scenarios:**
  - ordered
  - margins ≥ 2 %
  - Target is the maximum expected profit on the grid
  - rounded offers are multiples of `round_to_chf`
- **Fallback:**
  - forced by `WIN_MODEL=placeholder`
  - triggered when the history path does not exist
  - the result still has `win_curve`
- **Unchanged:** existing golden tests still pass.

## 13. Rules

- Do not change `app/pricing/scenarios.py` or the golden numbers.
- Never use `margin_pct`, `baseline_cost_chf`, `bid_date` or `won` as inputs.
- Fixed seeds everywhere: same CSV → same model → same curve.
- Guarded scikit-learn import; the API works without the extra.
- No OpenAI calls in tests.

## 14. Steps (in order; each ends with `make test` green)

| Step | Work |
| --- | --- |
| 1 | `schema.py`: column lists, derived features, CSV loading and validation, `TenderContext`; test fixture in `conftest.py` |
| 2 | `model.py`: pipeline, `train`, `evaluate`, monotonicity check, Laplace band, `PlaceholderWinModel` |
| 3 | `curve.py`: grid, curve, scenarios |
| 4 | `explain.py`: global relevance and per-tender breakdown (OpenAI summary optional, off) |
| 5 | `service.py`, config, parameters, `tender_context.json` fixture, `win_curve` in `price_tender`, `GET /api/win-model` (tests: `test_winprob_service.py`) |
| 6 | Once the real dataset is in `data/reference/v2/`: run `evaluate`, check the metrics and feature relevance, adjust nothing in the model structure unless a test fails |

## 15. Files

```
backend/app/winprob/
  schema.py      columns, derived features, loading/validation, TenderContext, CurvePoint
  model.py       WinModel protocol, LogisticWinModel, PlaceholderWinModel, train, evaluate
  curve.py       grid → offer → price position → probability → expected profit; scenarios
  explain.py     global relevance, per-tender breakdown, optional OpenAI summary
  service.py     load, train, check, fallback; model summary
  demo_data.py   synthetic history for tests and `make winprob` until the real data exists
  run.py         `make winprob`: train, evaluate, print and write the outputs
  synthetic.py   teammate's dataset generator (not part of this task)
backend/tests/test_winprob.py, backend/tests/conftest.py (fixture)
data/reference/v2/historical_bids.csv, data/reference/v2/market_snapshots.csv   (delivered separately)
data/samples/oberglatt/tender_context.json
docs/win-probability-model.md   this plan
```
