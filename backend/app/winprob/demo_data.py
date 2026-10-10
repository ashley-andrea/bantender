"""Synthetic bid history for running and testing the pipeline before the real dataset exists. Not the real data."""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADES = ["242", "243", "244", "245", "246", "250"]
BUILDINGS = ["school", "hospital", "office", "residential", "industrial", "public_building"]
CLIENTS = ["municipality", "canton", "federal", "private"]
CANTONS = ["ZH", "AG", "BE", "LU", "SG", "TG"]


def make_history(n: int = 1500, seed: int = 42) -> pd.DataFrame:
    """Hidden formula: price effect grows with price sensitivity; bidders, incumbent, prior wins, technical score,
    school and municipality matter; canton and n_lots do not."""
    rng = np.random.default_rng(seed)
    price_weight = rng.choice([40.0, 50.0, 60.0, 70.0], n)
    zero_at = rng.choice([1.3, 1.4, 1.5, 1.6], n)
    no_rule = rng.random(n) < 0.1
    sens = np.where(no_rule, 1.0, price_weight / ((zero_at - 1) * 100))
    market = np.exp(rng.normal(np.log(500_000), 0.8, n))
    pp = rng.normal(1.0, 0.1, n).clip(0.7, 1.4)
    bid = market * pp
    baseline = market * rng.normal(0.92, 0.06, n).clip(0.7, 1.1) * 0.95
    n_bidders = rng.integers(2, 11, n)
    building = rng.choice(BUILDINGS, n)
    client = rng.choice(CLIENTS, n)
    incumbent = (rng.random(n) < 0.2).astype(int)
    prior = rng.poisson(0.7, n)
    tech = rng.uniform(1, 5, n).round(1)
    logit = (
        0.5
        - 15 * (pp - 1) * sens
        - 0.8 * (np.log(n_bidders) - 1.5)
        - 0.6 * incumbent
        + 0.25 * np.minimum(prior, 3)
        + 0.3 * (tech - 3)
        + 0.4 * (building == "school")
        + 0.3 * (client == "municipality")
        + rng.normal(0, 0.3, n)
    )
    won = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    return pd.DataFrame({
        "bid_id": [f"B{i:05d}" for i in range(n)],
        "bid_date": pd.Timestamp("2023-08-01") + pd.to_timedelta(rng.integers(0, 3 * 365, n), unit="D"),
        "bkp_trade": rng.choice(TRADES, n),
        "building_type": building,
        "canton": rng.choice(CANTONS, n),
        "client_type": client,
        "procedure": rng.choice(["open", "invited"], n),
        "market_reference_chf": market.round(0),
        "n_lots": rng.integers(1, 4, n),
        "price_weight_pct": np.where(no_rule, np.nan, price_weight),
        "zero_at_ratio": np.where(no_rule, np.nan, zero_at),
        "n_bidders": n_bidders,
        "competitive_intensity": rng.uniform(1, 5, n).round(1),
        "strategic_appetite": rng.uniform(1, 5, n).round(1),
        "available_capacity_pct": rng.uniform(0, 100, n).round(0),
        "incumbent_present": incumbent,
        "prior_wins_with_client": prior,
        "technical_score_expected": tech,
        "baseline_cost_chf": baseline.round(0),
        "margin_pct": (100 * (1 - baseline / bid)).round(2),
        "bid_price_chf": bid.round(0),
        "won": won,
    })
