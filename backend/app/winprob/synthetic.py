"""Synthetic bid history for the win-probability model (data contract: docs/win-probability-model.md §4).

Outcomes come from a known hidden formula (GROUND_TRUTH), so we can check what the model recovers.
The model never reads GROUND_TRUTH. Deterministic for a seed.

    make winprob-data   # = uv run python -m app.winprob.synthetic --summary
"""

from __future__ import annotations

import argparse
import csv
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np

SEED = 42
N_ROWS = 2000
START = date(2023, 10, 1)
END = date(2026, 9, 30)
ROUND_TO_CHF = 1000

OUT_DIR = Path(__file__).resolve().parents[3] / "data" / "reference" / "v2"

BID_COLUMNS = [
    "bid_id", "bid_date", "bkp_trade", "building_type", "canton", "client_type", "procedure",
    "n_lots", "price_weight_pct", "zero_at_ratio", "n_bidders",
    "competitive_intensity", "strategic_appetite", "available_capacity_pct", "incumbent_present",
    "prior_wins_with_client", "technical_score_expected", "baseline_cost_chf", "margin_pct",
    "bid_price_chf", "won",
]
SNAPSHOT_COLUMNS = ["snapshot_date", "competitive_intensity", "strategic_appetite", "available_capacity_pct"]

# How often each value occurs (relative weights).
TRADES = {"242": 8, "243": 20, "244": 30, "245": 12, "246": 8, "250": 22}
BUILDINGS = {"school": 22, "hospital": 10, "office": 20, "residential": 22, "industrial": 12, "public_building": 14}
CANTONS = {"ZH": 28, "BE": 15, "AG": 12, "VD": 10, "SG": 9, "LU": 8, "BS": 6, "GE": 6, "TG": 6}
CLIENT_BY_BUILDING = {
    "school": {"municipality": 85, "canton": 10, "private": 5},
    "hospital": {"canton": 70, "municipality": 15, "private": 15},
    "office": {"private": 75, "canton": 10, "federal": 10, "municipality": 5},
    "residential": {"private": 80, "municipality": 20},
    "industrial": {"private": 90, "federal": 10},
    "public_building": {"municipality": 45, "canton": 35, "federal": 20},
}
# Median market value of the job per building type (CHF), log-normal spread around it. Hidden: not in the CSV.
SIZE_MEDIAN = {"school": 1.2e6, "hospital": 2.5e6, "office": 1.0e6, "residential": 0.6e6, "industrial": 0.9e6, "public_building": 1.0e6}
SIZE_LOG_SD = 0.8
SIZE_RANGE = (120_000, 9_000_000)

# Award rules: public clients always state one; some private clients state none.
PUBLIC_WEIGHTS, PUBLIC_ZERO = [30, 40, 50, 50, 60, 60, 70], [1.3, 1.5, 1.5, 2.0]
PRIVATE_WEIGHTS, PRIVATE_ZERO = [60, 70, 80, 100], [1.3, 1.5]
PRIVATE_NO_RULE_SHARE = 0.25

# Our cost ÷ the job's market value: where we are competitive. Learnable from trade, building, canton and their
# combinations; only a small part is unexplained. log(ratio) = log(base) + Σ effects + Normal(0, noise_sd).
COMPETITIVENESS = {
    "base": 0.93,
    "trade": {"242": 0.015, "243": 0.0, "244": -0.025, "245": 0.005, "246": 0.025, "250": -0.005},
    "building": {"school": -0.01, "hospital": 0.015, "office": 0.0, "residential": 0.005, "industrial": 0.005, "public_building": -0.005},
    "canton": {"ZH": -0.015, "AG": -0.005, "BE": 0.0, "LU": 0.0, "SG": 0.0, "TG": 0.0, "BS": 0.005, "VD": 0.02, "GE": 0.025},
    "combo": {("244", "school"): -0.02, ("250", "hospital"): 0.02, ("243", "residential"): -0.015},
    "noise_sd": 0.02,
    "range": (0.75, 1.10),
}

# Hidden formula: logit p = b0 + Σ terms + noise, with price position = our offer ÷ the job's market value.
# n_lots and strategic_appetite have NO effect (distractors).
GROUND_TRUTH = {
    "b0": -0.85,
    "b_price": -0.20,               # per 1 % of price position above 1.0, at price sensitivity 1.2 (scales linearly with it)
    "sensitivity_ref": 1.2,
    "sensitivity_if_no_rule": 2.0,  # tenders stating no award rule are price-driven (true value; the data shows a blank)
    "b_log_bidders": -0.70,
    "b_intensity": -0.25,           # per point above 3
    "b_incumbent": -0.50,
    "b_prior_wins": 0.30,           # per prior win, capped at 3
    "b_tech": 0.35,                 # per point above 3
    "b_capacity": 0.40,             # per 50 points of free capacity above 50 %
    "b_log_size": -0.15,            # per log unit of market value above CHF 1 M
    "b_trade": {"242": -0.25, "243": 0.0, "244": 0.30, "245": -0.20, "246": -0.35, "250": 0.10},
    "b_building": {"school": 0.30, "hospital": -0.10, "office": 0.0, "residential": -0.25, "industrial": 0.15, "public_building": 0.20},
    "b_client": {"municipality": 0.0, "canton": -0.30, "federal": -0.50, "private": 0.40},
    "b_procedure": {"open": 0.0, "invited": 0.45},
    "b_combo": {("244", "school"): 0.40, ("250", "hospital"): -0.40, ("245", "office"): 0.30},  # trade × building
    "noise_sd": 0.5,                # unobserved factors
}

# How our estimators chose the margin (behaviour; not part of the outcome formula).
MARGIN_BEHAVIOUR = {
    "base_pct": 5.5,
    "per_appetite_point": -0.8,      # keener → cheaper
    "per_free_capacity_pct": -0.04,  # busy (little free capacity) → dearer
    "per_intensity_point": -0.5,     # hungry market → cheaper
    "noise_sd": 2.0,
    "range_pct": (0.0, 15.0),
}


def _choice(rng: np.random.Generator, weights: dict, size: int) -> np.ndarray:
    keys = np.array(list(weights))
    p = np.array(list(weights.values()), dtype=float)
    return keys[rng.choice(len(keys), size=size, p=p / p.sum())]


def _round_up(x: np.ndarray, step: float) -> np.ndarray:
    return np.ceil(x / step - 1e-9) * step


def _lookup(table: dict, values: np.ndarray) -> np.ndarray:
    return np.array([table[str(v)] for v in values], dtype=float)


def price_sensitivity(price_weight_pct: np.ndarray, zero_at_ratio: np.ndarray) -> np.ndarray:
    """Price points lost per 1 % above the lowest offer; NaN when the tender states no rule."""
    return np.asarray(price_weight_pct, dtype=float) / ((np.asarray(zero_at_ratio, dtype=float) - 1) * 100)


def _combo(table: dict, trade: np.ndarray, building: np.ndarray) -> np.ndarray:
    return np.array([table.get((str(t), str(b)), 0.0) for t, b in zip(trade, building)])


def competitiveness(trade: np.ndarray, building: np.ndarray, canton: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Our cost ÷ the job's market value, per bid."""
    c = COMPETITIVENESS
    log_ratio = (np.log(c["base"]) + _lookup(c["trade"], trade) + _lookup(c["building"], building) + _lookup(c["canton"], canton)
                 + _combo(c["combo"], trade, building) + rng.normal(0, c["noise_sd"], len(trade)))
    return np.clip(np.exp(log_ratio), *c["range"])


def true_logit(cols: dict, gt: dict = GROUND_TRUTH) -> np.ndarray:
    """The hidden formula without noise. `cols` maps column names to arrays (blank award rule = NaN) and must carry
    the hidden `_market_value` (generate() returns it; it is not written to the CSV)."""
    f = lambda name: np.asarray(cols[name], dtype=float)  # noqa: E731
    sens = price_sensitivity(cols["price_weight_pct"], cols["zero_at_ratio"])
    sens = np.where(np.isnan(sens), gt["sensitivity_if_no_rule"], sens)
    pp = f("bid_price_chf") / f("_market_value")
    return (
        gt["b0"]
        + gt["b_price"] * (pp - 1) * 100 * sens / gt["sensitivity_ref"]
        + gt["b_log_bidders"] * np.log(f("n_bidders"))
        + gt["b_intensity"] * (f("competitive_intensity") - 3)
        + gt["b_incumbent"] * f("incumbent_present")
        + gt["b_prior_wins"] * np.minimum(f("prior_wins_with_client"), 3)
        + gt["b_tech"] * (f("technical_score_expected") - 3)
        + gt["b_capacity"] * (f("available_capacity_pct") - 50) / 50
        + gt["b_log_size"] * np.log(f("_market_value") / 1e6)
        + _lookup(gt["b_trade"], cols["bkp_trade"])
        + _lookup(gt["b_building"], cols["building_type"])
        + _lookup(gt["b_client"], cols["client_type"])
        + _lookup(gt["b_procedure"], cols["procedure"])
        + _combo(gt["b_combo"], cols["bkp_trade"], cols["building_type"])
    )


def true_probability(cols: dict, gt: dict = GROUND_TRUTH) -> np.ndarray:
    """Probability without the unobserved noise term: the best any model on these columns can do."""
    return 1 / (1 + np.exp(-true_logit(cols, gt)))


def generate_snapshots(rng: np.random.Generator) -> dict[str, np.ndarray]:
    """Quarterly manual updates of market data: each value drifts but is pulled back to its usual level."""
    dates, d = [], START
    while d <= END:
        dates.append(d)
        d = date(d.year + (d.month + 2) // 12, (d.month + 2) % 12 + 1, 1)

    def series(centre: float, sd: float, lo: float, hi: float, pull: float = 0.5) -> np.ndarray:
        x = [centre]
        for _ in dates[1:]:
            x.append(centre + (1 - pull) * (x[-1] - centre) + rng.normal(0, sd))
        return np.clip(x, lo, hi)

    return {
        "snapshot_date": np.array(dates),
        "competitive_intensity": np.round(series(3.0, 0.5, 1.5, 4.5), 1),
        "strategic_appetite": np.round(series(3.0, 0.5, 1.5, 4.5), 1),
        "available_capacity_pct": np.round(series(45.0, 12, 15, 85)),
    }


def generate(n: int = N_ROWS, seed: int = SEED) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """(bids, snapshots) as column arrays; bids sorted by date with ids B00001…"""
    rng = np.random.default_rng(seed)
    snaps = generate_snapshots(rng)

    days = np.sort(rng.integers(0, (END - START).days + 1, n))
    bid_date = np.array([START + timedelta(days=int(d)) for d in days])
    snap = np.searchsorted(snaps["snapshot_date"], bid_date, side="right") - 1

    trade = _choice(rng, TRADES, n)
    building = _choice(rng, BUILDINGS, n)
    client = np.empty(n, dtype=object)
    for b, weights in CLIENT_BY_BUILDING.items():
        mask = building == b
        client[mask] = _choice(rng, weights, int(mask.sum()))
    client = client.astype(str)
    public = client != "private"
    procedure = np.where(rng.random(n) < np.where(public, 0.3, 0.6), "invited", "open")

    canton = _choice(rng, CANTONS, n)
    lo, hi = SIZE_RANGE
    market_value = np.clip(_lookup(SIZE_MEDIAN, building) * np.exp(rng.normal(0, SIZE_LOG_SD, n)), lo, hi)

    weight = np.where(public, rng.choice(PUBLIC_WEIGHTS, n), rng.choice(PRIVATE_WEIGHTS, n)).astype(float)
    zero = np.where(public, rng.choice(PUBLIC_ZERO, n), rng.choice(PRIVATE_ZERO, n))
    no_rule = ~public & (rng.random(n) < PRIVATE_NO_RULE_SHARE)
    weight[no_rule], zero[no_rule] = np.nan, np.nan

    intensity = np.round(np.clip(snaps["competitive_intensity"][snap] + rng.normal(0, 0.4, n), 1, 5), 1)
    appetite = np.round(np.clip(snaps["strategic_appetite"][snap] + rng.normal(0, 0.6, n), 1, 5), 1)
    capacity = np.round(np.clip(snaps["available_capacity_pct"][snap] + rng.normal(0, 8, n), 0, 100))

    open_lambda = np.maximum(0.5, 3 + 1.2 * (intensity - 3) + 0.5 * np.log(market_value / 1e6))
    n_bidders = np.where(procedure == "invited", rng.integers(3, 6, n), np.clip(2 + rng.poisson(open_lambda), 2, 12))

    m = MARGIN_BEHAVIOUR
    margin = np.clip(
        m["base_pct"] + m["per_appetite_point"] * (appetite - 3) + m["per_free_capacity_pct"] * (capacity - 50)
        + m["per_intensity_point"] * (intensity - 3) + rng.normal(0, m["noise_sd"], n),
        *m["range_pct"],
    )
    baseline = np.round(market_value * competitiveness(trade, building, canton, rng), 2)
    bid = _round_up(baseline / (1 - margin / 100), ROUND_TO_CHF)

    bids = {
        "bid_id": np.array([f"B{i + 1:05d}" for i in range(n)]),
        "bid_date": bid_date,
        "bkp_trade": trade,
        "building_type": building,
        "canton": canton,
        "client_type": client,
        "procedure": procedure,
        "n_lots": rng.choice([1, 2, 3, 4], n, p=[0.60, 0.25, 0.10, 0.05]),
        "price_weight_pct": weight,
        "zero_at_ratio": zero,
        "n_bidders": n_bidders,
        "competitive_intensity": intensity,
        "strategic_appetite": appetite,
        "available_capacity_pct": capacity.astype(int),
        "incumbent_present": (rng.random(n) < 0.3).astype(int),
        "prior_wins_with_client": np.minimum(rng.poisson(np.where(public, 0.7, 1.2)), 5),
        "technical_score_expected": np.round(np.clip(rng.normal(3.3, 0.6, n), 1, 5), 1),
        "baseline_cost_chf": baseline,
        "margin_pct": np.round(100 * (1 - baseline / bid), 2),
        "bid_price_chf": bid.astype(int),
        "_market_value": market_value,  # hidden truth, never written to the CSV
    }
    logit = true_logit(bids) + rng.normal(0, GROUND_TRUTH["noise_sd"], n)
    bids["won"] = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    return bids, snaps


def _cell(v) -> str:
    if isinstance(v, (float, np.floating)):
        return "" if math.isnan(v) else np.format_float_positional(round(float(v), 4), trim="-")
    return str(v)


def write_csv(cols: dict[str, np.ndarray], path: Path, columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(columns)
        writer.writerows(zip(*([_cell(v) for v in cols[c]] for c in columns)))


def summary(bids: dict[str, np.ndarray]) -> str:
    """Sanity checks: win rate overall, by margin and by a few features; truth vs observed."""
    won = bids["won"]
    rate = lambda mask: f"{100 * won[mask].mean():5.1f} % (n={mask.sum()})" if mask.any() else "  —"  # noqa: E731
    margin = bids["margin_pct"]
    p_true = true_probability(bids)
    lines = [f"bids {len(won)}, {bids['bid_date'][0]} → {bids['bid_date'][-1]}, win rate {rate(won >= 0)}",
             f"mean true probability (no noise) {100 * p_true.mean():.1f} %", "win rate by margin:"]
    for lo, hi in [(0, 2), (2, 4), (4, 6), (6, 8), (8, 10), (10, 99)]:
        lines.append(f"  {lo:>2}–{hi:<2} %  {rate((margin >= lo) & (margin < hi))}")
    for col in ("bkp_trade", "building_type", "client_type", "procedure", "canton"):
        lines.append(f"win rate by {col}:")
        lines += [f"  {v:<16} {rate(bids[col] == v)}" for v in sorted(set(bids[col]))]
    q = np.percentile(bids["margin_pct"], [10, 50, 90])
    lines.append(f"margin % p10/p50/p90: {q[0]:.1f} / {q[1]:.1f} / {q[2]:.1f}")
    lines.append(f"no award rule: {int(np.isnan(bids['price_weight_pct']).sum())} bids")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate the synthetic bid history and market snapshots.")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--n", type=int, default=N_ROWS)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--summary", action="store_true")
    args = ap.parse_args()
    bids, snaps = generate(args.n, args.seed)
    write_csv(bids, args.out / "historical_bids.csv", BID_COLUMNS)
    write_csv(snaps, args.out / "market_snapshots.csv", SNAPSHOT_COLUMNS)
    print(f"wrote {len(bids['won'])} bids and {len(snaps['snapshot_date'])} snapshots to {args.out}")
    if args.summary:
        print(summary(bids))


if __name__ == "__main__":
    main()
