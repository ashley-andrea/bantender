# Win-probability model: design decisions

Status: agreed design, not yet implemented (2026-10-10).

## Goal

Replace the placeholder win-probability formula with a model **learned from our bid history**, so the relation between offer and win probability changes as data accumulates. The model computes a **full curve** for a tender in one pass. The UI slider explores it, and the three bid scenarios are read from it.

## Where we start from

The placeholder in [`scenarios.py`](../backend/app/pricing/scenarios.py) (parameters in `project_parameters.json → stretch_bid_optimization`):

```
p = 0.55 + 0.05 (appetite) − 0.05 (competition) − 0.05 × (offer / ref − 1) × 100,  clamped to [0.05, 0.95]
ref = cost baseline ÷ (1 − 5.5 % target margin)
```

Scenarios use fixed margins (Aggressive 2.5 %, Target 4.0 %, Conservative 6.5 %).

Problems we found:

- It is linear: 5 probability points lost per 1 % of price, everywhere.
- It ignores tender type, market conditions and the tender's award rule.
- The 5.5 % target margin and the 4.0 % "Target" scenario disagree.
- Its scenarios are fixed margins and are not derived from the curve.

The golden numbers in `expected_output_example.json` are three (margin, probability) pairs: (2.5 %, 0.69), (4.0 %, 0.63), (6.5 %, 0.49). They are **outputs of the placeholder formula, not observations**, so they are not training data.

## Decisions

### 1. The curve is over the offer, not the margin

The client accepts or rejects an **offer**; the margin is only a consequence of it. Offers in CHF cannot be compared across tenders of different size, so the model works on the offer relative to **our own cost baseline**:

```
x = offer ÷ cost baseline      (offer = cost baseline ÷ (1 − margin))
```

- The UI axis and the slider are in **CHF offer**. The margin is shown next to each offer.
- Option rejected for now: a market reference price independent of our costs, such as the build-up at catalogue list prices instead of net prices. The interface should allow adding it later.

### 2. One full curve, computed at once

For each tender, the API returns the whole curve on a grid of offers. Each point has:

- offer (CHF) and the resulting margin
- win probability, with an uncertainty band
- expected contribution = (offer − cost baseline) × p(offer)

The slider only reads precomputed points; nothing is recomputed while sliding.

### 3. Scenarios come from the curve

The expected contribution is the average profit per tender if we bid this way many times. Cheap offers win often but earn little. Expensive offers earn a lot but rarely win. In between there is a peak.

| Scenario | Definition |
|---|---|
| **Target** | The offer with the highest expected contribution |
| **Aggressive** | The **lowest** offer whose expected contribution is still ≥ 90 % of the peak: higher win chance, for when we really want the job |
| **Conservative** | The **highest** offer whose expected contribution is still ≥ 90 % of the peak: more profit per win, for when we are busy |

The span from Aggressive to Conservative is the *Recommended Bid Range*.

- Tolerance: **90 %** of the peak (parameter).
- Minimum margin: **2 %**. No scenario or recommendation goes below it (company policy, parameter).

Illustration only, using the placeholder curve on the golden subset (cost CHF 414,489):

| Margin | Offer | Profit if won | p(win) | Expected contribution |
|---|---|---|---|---|
| 4 % | 431,760 | 17,271 | 63 % | 10,848 |
| 6 % | 440,946 | 26,457 | 52 % | 13,848 |
| **8 %** | **450,532** | **36,042** | **41 %** | **14,926** (peak) |
| 10 % | 460,543 | 46,054 | 30 % | 13,816 |
| 12 % | 471,010 | 56,521 | 18 % | 10,212 |

With these values the range would be about 5.6 % (Aggressive), 8.0 % (Target) and 10.3 % (Conservative).

### 4. Tender keywords

Each tender is described by four keywords in a **fixed order**, most general first:

| Level | Values | Read from the tender |
|---|---|---|
| Trade | ventilation, heating, air conditioning, refrigeration, plumbing | BKP code (the parser already finds it; 244 → ventilation) |
| Building type | school, hospital, office, residential, industrial, public building | Words in the project name (e.g. "Schule", "Schulhaus" → school; "Spital", "Klinik" → hospital) |
| Size class | S < CHF 0.5 M, M 0.5–2 M, L > 2 M | Our cost baseline |
| Region | Zurich, Bern, Northwest, Central, Eastern, Romandie | Postal code in the tender documents (mapping table in code) |

- The parser derives the keywords deterministically. **The estimator can override each one** in the UI.
- If a keyword cannot be read, it is left out. Its effect is zero and the UI says so (e.g. "region unknown").
- The order is set by domain knowledge, not learned. Trade comes first because it is always known.

### 5. Market data: competitive pressure only

Market data is not in the tender. It is **entered manually from time to time** (e.g. quarterly) as a market snapshot:

- **Competitive pressure**, on a 1–5 scale (1 = competitors are busy, 5 = the market is hungry for work).

Each historical bid uses the snapshot that was current on its date. A new tender uses the latest snapshot.

**Dropped:** strategic appetite and available capacity. They express how much *we* want the job. That does not change whether the client accepts an offer, so they do not belong in the win-probability model. (The placeholder's +5-point appetite bonus is removed for that reason.)

### 6. The award rule sets the steepness

Swiss public tenders score each offer as price points plus quality points. Oberglatt gives price 60 of 100 points: the lowest offer gets 60, falling linearly to 0 at 150 % of the lowest. Being 10 % above the lowest therefore costs 12 points. With a rule of 30 points and 0 at 200 %, it costs only 3 points, and quality decides.

The rule is in the tender (already parsed by `parse_award`) and is known before bidding. The model uses it to **scale the slope** of the curve:

```
price sensitivity = points lost per 1 % above the lowest offer = weight ÷ ((zero_at_ratio − 1) × 100)
                    (Oberglatt: 60 ÷ 50 = 1.2)
```

How strongly the slope follows this sensitivity is learned from the data. If a tender states no rule, the sensitivity is neutral (the average of the history).

### 7. Model structure: shared keyword effects plus combination corrections

The model is a logistic curve in the offer:

```
logit p = intercept − slope × (x − x₀) + γ × (competitive pressure − 3)
```

`x₀` is a fixed centring point, e.g. the offer at a 5 % margin.

The intercept and the slope are both built from:

1. **A global value**, learned from all bids.
2. **Main effects**, one per keyword: a shift for "school", for "ventilation" and so on. Each is learned from **every** bid that has that keyword, across all other keywords, so the data is used efficiently.
3. **Combination corrections**, following the fixed order: trade × building type, then trade × building type × size, then adding region. Each starts at **zero** and moves away from zero only as its own data accumulates. This is how the model *specializes*: smoothly, with no hard threshold.

Rules:

- All effects are shrunk towards zero (penalized logistic regression, i.e. a Gaussian prior). Deeper combinations, and effects on the slope, are shrunk harder.
- The shrinkage strength is chosen by **out-of-time validation**: train on the first 2.5 years, evaluate on the last 6 months.
- The award-rule sensitivity scales the slope (decision 6).
- **The slope is always positive**: a higher offer never raises the win probability.
- The uncertainty band comes from the fit's covariance. It is wide for rare keyword combinations.

For each tender the UI can explain the curve step by step, e.g. "ventilation −3 pts · school +5 pts · ventilation × school correction (42 bids) +2 pts · competitive pressure 4 −4 pts".

### 8. Synthetic dataset

We have no real history, so we generate one. It is for our own use only and **does not need to be realistic**.

- **2,000 bids over 3 years** (2023-10 to 2026-09), reproducible from a fixed seed.
- **One row per bid**, with only what we would really know: date, the four keywords, cost baseline, offer (and margin), the award rule (weight, zero-points ratio, or none), and won/lost.
- **No competitor bids** (in reality we would not have them).
- **Market snapshots** in their own table: one row per manual update, with date and competitive pressure.
- **How outcomes are generated:** from a hidden "true" curve built with the same structure as the model: global, plus keyword effects, plus a few sizeable combination effects, plus pressure and award sensitivity. Outcomes are drawn at random from it. Because the truth is known, we can show that the model recovers it, and how its accuracy improves as the number of bids grows.
- **How offers are chosen:** margins vary around ~5 % with a realistic spread, and estimators bid a little lower when pressure is high. The model must therefore include pressure to avoid a biased slope.
- Keyword frequencies are generic. **The Oberglatt segment (ventilation / school / M / Zurich) is not given special weight**, to avoid tuning the demo to our own case.

### 9. Runtime

- The model is **fitted at API startup** from the bid history and the market snapshots. Refitting is cheap: there is no stored model file.
- If there is no history, the system falls back to the placeholder formula, and the curve and scenarios are computed from it. The output says which source was used.
- `test_golden_scenarios` keeps testing the placeholder (the fallback). New tests cover the learned model:
  - it recovers the hidden truth
  - the slope is always positive
  - scenarios are ordered Aggressive < Target < Conservative and respect the 2 % minimum
  - out-of-time validation beats the placeholder and a model without keywords

## Planned layout (tentative)

| What | Where |
|---|---|
| Bid history, market snapshots | `data/reference/v2/bid_history.csv`, `data/reference/v2/market_snapshots.csv` |
| Generator, model, curve and scenarios | `backend/app/winprob/` |
| New parameters (tolerance 90 %, minimum margin 2 %, offer grid) | `project_parameters.json` |
| API | Pricing result gains the curve, the scenarios, the keyword explanation and the model source; a model summary endpoint (data used, validation scores) |
| UI | Slider over the curve (later) |
