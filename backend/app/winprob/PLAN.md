# Win-probability module — plan

Status: **boilerplate only**. Every function raises `NotImplementedError`. Build it step by step (see "Steps"); do not do everything at once.

## 1. Goal

Predict the probability (0–100 %) that our offer for a tender is accepted, learned from historical bids.
Output: one probability per margin (0.5 % steps), plus the expected profit at each margin. Later: a chart in the UI.

This is the "AI" part of the hackathon project. The rest of the app is deterministic (see the root `README.md`).

## 2. Context in the existing code (read before implementing)

| What | Where | Why it matters |
| --- | --- | --- |
| Placeholder win model (linear, from Equans) | `app/pricing/scenarios.py::win_probability` | Kept as the **fallback**. Must not change. |
| Bid scenarios (Aggressive/Target/Conservative) | `app/pricing/scenarios.py::bid_scenarios` | Golden test pins 0.69 / 0.63 / 0.49. Must keep passing. |
| Parameters incl. `model_inputs` list | `data/reference/v1/project_parameters.json` → `stretch_bid_optimization` | Equans' expected inputs; our columns cover them. |
| Price formula | `app/pricing/engine.py::build_project` | `price = round_up(baseline / (1 − margin), round_to_chf)` |
| Pricing result assembled | `app/pricing/service.py::price_tender` | Where the curve gets added (new key, existing keys unchanged). |
| Award rule read from the tender | `app/parsing/tender_info.py::parse_award` | Gives `price_weight` and `zero_at_ratio` for the current tender. |
| AI config | `app/config.py` (`ai_provider`, `openai_model`, `openai_budget_usd`) | Used by the OpenAI explanation step. |
| Reference data loaded at import | `app/api/main.py` (`reference = load_reference(...)`) | Load/train the win model the same way. |

## 3. Decisions already taken

1. **Predict from price position, not margin.** Model input = `price_position = bid_price / market_reference_chf`. The margin curve is derived: margin → price (existing formula) → price position → probability. Margin itself is **not** a model feature.
2. **A lower margin always means a higher probability.** The curve must be monotonic (non-increasing in margin). Enforced by the model choice and checked by a test.
3. **Fake data from a known hidden formula** (`synthetic.py::GROUND_TRUTH`). Learnable but not trivial (noise, distractors, one interaction, one confounder). Lets us show the model recovers the truth.
4. **Added alongside the placeholder.** Setting `win_model = "ml" | "placeholder"`. If the ML model is unavailable (missing deps, training failed), fall back to the placeholder automatically. Existing `scenarios` output and golden tests are untouched.
5. **Tender inputs come from an ingestion pipeline** (assumed to exist and to be up to date). For the demo, a JSON fixture stands in for it (`data/samples/oberglatt/tender_context.json`).
6. **Margin grid: 0.5 % steps.** Range is open (see 4.3).
7. **Output now: the probability curve and the expected profit.** The recommended margin comes later.
8. **Several trades, small spectrum:** Swiss BKP building-services trades 243 (heat distribution), 244 (ventilation), 245 (air conditioning), 250 (plumbing).
9. **Train when the API starts** (see 4.2 for details).
10. **LLM = OpenAI** for a plain-language explanation of the curve (later step, budget-capped, behind `ai_provider`).

## 4. Open decisions (options + current default)

| # | Question | Options | Default for now |
| --- | --- | --- | --- |
| 4.1 | Model type | (a) logistic regression; (b) gradient boosting with a monotonic constraint on price position + calibration; (c) both, compared | Start with **(a)**. Add (b) only in step 6, as a comparison. Fake data makes both look good, so judge on calibration and monotonicity, not only AUC. |
| 4.2 | Training lifecycle | (a) train at every API start; (b) train at start, cache to `data/runtime/winprob/model.pkl` keyed by a hash of the history CSV; (c) offline `make train` only | **(b)**: trains in under 1 s on about 1,500 rows, reproducible (fixed seed), skips retraining when the data is unchanged. |
| 4.3 | Margin range | 0–15 %, 0–20 %, −2–20 % (negative = loss-leader bids) | **0–20 %**, step 0.5 % (41 points). Configurable. |
| 4.4 | Dependencies | (a) `scikit-learn` (+ numpy, scipy) in the API image, about +100–150 MB; (b) sklearn only for training, then export the coefficients to JSON and score in plain Python (logistic regression only) | **(a)** as an optional extra `winprob` in `pyproject.toml`; the import is guarded so the API still runs on the placeholder without it. Revisit (b) if image size matters. |
| 4.5 | Market reference for a **new** tender | (a) the client's cost estimate from the ingestion pipeline; (b) our price at the target margin (what the placeholder does); (c) a second model predicting the market price from similar projects | **(a)**; if missing, fall back to **(b)** and flag it in the output. (c) is a later idea. |
| 4.6 | History storage | CSV in `data/reference/v1/historical_bids.csv`; later PostgreSQL | **CSV**, generated once with a fixed seed and committed (deterministic tests). |
| 4.7 | Chart | Chart library in the frontend (e.g. Recharts); table only | Decide later. |
| 4.8 | What is sent to OpenAI | Curve numbers only; plus tender facts; nothing company-internal | Curve numbers and non-sensitive tender facts only. Costs, catalogue and baseline stay on the server (README principle). |

## 5. Data schema (one row = one past bid)

Column names are in `schema.py` (single source of truth). "Source at prediction time" says where the value comes from for a **new** tender.

| Column | Type / range | Role | Source at prediction time |
| --- | --- | --- | --- |
| `bid_id` | str | id | — |
| `bid_date` | date 2021–2026 | time-based train/test split only | — |
| `bkp_trade` | cat: 243, 244, 245, 250 | feature | parser (`project.bkp`) |
| `client_type` | cat: municipality, canton, federal, private | feature | ingestion |
| `canton` | cat: ZH, AG, BE, LU, SG, TG | feature (**distractor**, no true effect) | ingestion |
| `procedure` | cat: open, invited | feature | ingestion |
| `market_reference_chf` | float, log-normal ≈ 150k–8M | used to compute `price_position`; log value also a feature | ingestion (client cost estimate), see 4.5 |
| `n_lots` | int 1–4 | feature (**distractor**) | parser (`lots`) |
| `price_weight_pct` | float 30–70 | feature + interaction with price | parser (`award.weight`) |
| `n_bidders` | int 2–10 | feature | ingestion |
| `competitive_intensity` | int 1–5, correlated with `n_bidders` | feature | ingestion |
| `incumbent_present` | bool | feature | ingestion |
| `prior_wins_with_client` | int 0–5 | feature | ingestion (CRM) |
| `strategic_appetite` | int 1–5 | feature | ingestion / estimator |
| `available_capacity_pct` | float 0–100 | feature (**confounder**: low capacity → we bid higher; small direct effect) | ingestion |
| `technical_score_expected` | float 1–5 | feature | ingestion |
| `baseline_cost_chf` | float | used to build the bid in the fake data; **not a feature** | pricing engine |
| `margin_pct` | float | display / analysis only; **not a feature** | the curve grid |
| `bid_price_chf` | float | used to compute `price_position` | the curve grid |
| `price_position` | float ≈ 0.8–1.3 | **main feature** = `bid_price_chf / market_reference_chf` | computed per grid point |
| `won` | 0/1 | **target** | — |
| `winning_price_chf`, `our_rank` | — | **leakage, never features** (known only after the award) | — |

## 6. Hidden formula for the fake data (`synthetic.py`)

The win probability is generated by a logistic function of the features, then `won ~ Bernoulli(p)`:

```
logit(p) = b0
         + b_price  * (price_position − 1) * 100 * (price_weight_pct / 50)   # interaction: price matters more when it weighs more
         + b_bidders * log(n_bidders)
         + b_intensity * competitive_intensity
         + b_incumbent * incumbent_present
         + b_prior * min(prior_wins_with_client, 3)                            # saturating
         + b_tech * (technical_score_expected − 3)
         + b_client[client_type] + b_proc[procedure] + b_trade[bkp_trade]
         + b_capacity * available_capacity_pct / 100                           # small direct effect
         + noise ~ Normal(0, sigma)                                            # unobserved factors
```

- `canton` and `n_lots` have no effect (distractors).
- Confounder: `margin_pct` is drawn higher when `available_capacity_pct` is low, so price position and capacity are correlated.
- `baseline_cost_chf / market_reference_chf` ~ Normal(0.92, 0.06): our cost efficiency varies by tender.
- Tune the coefficients so that the overall win rate is about 25–35 % and the probability at price position 1.0 with average features is about 40 %.
- Size: about 1,500 rows, fixed seed. Coefficients live in `GROUND_TRUTH` (visible to us, never read by the model).

## 7. Curve output (contract)

Added to the `price_tender` result as a new key `win_curve` (existing keys unchanged):

```json
{
  "model": "ml | placeholder",
  "model_version": "logreg-<data hash>",
  "market_reference_chf": 1820000,
  "market_reference_source": "ingestion | target_margin_fallback",
  "points": [
    {"margin_pct": 0.0, "bid_price": 1660000, "price_position": 0.912,
     "win_probability": 0.71, "expected_profit": 0.0}
  ]
}
```

`expected_profit = win_probability × (bid_price − baseline)`, the same definition as `Scenario.expected_contribution`.

## 8. Steps (do in order; each ends green)

| Step | Work | Done when |
| --- | --- | --- |
| 1 | `synthetic.py`: implement `generate()` and `write_csv()`; add CLI `python -m app.cli winprob-generate`; commit `data/reference/v1/historical_bids.csv` | CSV exists; win rate 25–35 %; probability falls as price position rises (binned check) |
| 2 | `model.py`: `LogisticWinModel` (sklearn pipeline: one-hot categoricals + scaled numerics + LogisticRegression); `train()` with a time-based split; `evaluate()` → AUC, Brier, log loss, calibration bins | Test AUC ≥ 0.75; price coefficient negative; prints a metrics dict |
| 3 | `curve.py`: `margin_grid()`, `win_curve()` using the engine's `round_up` | Monotonic test passes; 41 points for 0–20 % |
| 4 | `service.py`: `get_win_model()` (train at start + cache, see 4.2) and placeholder fallback; add `win_model`, `winprob_history_path`, margin range to `app/config.py`; wire `win_curve` into `price_tender`; add `tender_context.json` fixture | Golden tests unchanged and green; `/api` result has `win_curve`; fallback works with sklearn uninstalled |
| 5 | `explain.py`: OpenAI summary of the curve (budget-capped, only when `ai_provider != "off"`) | Returns text; skipped cleanly when off |
| 6 | (optional) Gradient boosting with a monotonic constraint; compare with logistic regression on the same split | Comparison table in the metrics output |
| 7 | (later) Frontend chart, uncertainty band, recommended margin | — |

Tests go in `backend/tests/test_winprob.py`. They must run offline, without OpenAI, in a few seconds (`make test`).

## 9. Later ideas (not now)

- **Uncertainty band:** bootstrap the training (e.g. 200 refits), report the 10th/90th percentile per margin.
- **Recommended margin:** argmax of the expected profit, optionally with a minimum-probability constraint.
- **Award points link:** combine with `award_price_points` (price points vs. the expected lowest offer).
- **Market-price model (4.5c):** predict `market_reference_chf` from similar projects.
- **Real data:** swap the CSV for CRM exports or public award notices (e.g. simap.ch); the schema stays the same.
- **Coefficients as JSON** for serving without sklearn (4.4b).

## 10. Files

```
app/winprob/
  PLAN.md        this file
  __init__.py    public exports
  schema.py      column names, feature lists, TenderContext, CurvePoint
  synthetic.py   GROUND_TRUTH + fake history generator
  model.py       WinModel protocol, LogisticWinModel, PlaceholderWinModel, train/evaluate
  curve.py       margin grid → price → position → probability → expected profit
  service.py     model lifecycle (train at start, cache, fallback)
  explain.py     OpenAI explanation of the curve (later)
```

## 11. Rules for the implementing agent

- Do not change `app/pricing/scenarios.py` behaviour or the golden numbers.
- `margin_pct`, `baseline_cost_chf`, `winning_price_chf` and `our_rank` are never model features.
- Fixed random seeds everywhere; same CSV → same model → same curve.
- Guard sklearn imports: the API must start and price tenders without the `winprob` extra.
- No OpenAI calls in tests.
