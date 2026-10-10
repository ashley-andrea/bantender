"""Fake bid history generated from a known hidden formula. Generated separately (see the plan §2). The model never reads GROUND_TRUTH."""

from __future__ import annotations

from pathlib import Path

SEED = 42
N_ROWS = 1500

# Starting values; tune so the overall win rate is ~25–35 %.
GROUND_TRUTH = {
    "b0": 0.0,
    "b_price": -0.25,  # per 1 % above the market reference, at price_weight_pct = 50
    "b_bidders": -0.6,
    "b_intensity": -0.15,
    "b_incumbent": -0.5,
    "b_prior": 0.25,
    "b_tech": 0.3,
    "b_capacity": 0.2,
    "b_client": {"municipality": 0.0, "canton": -0.1, "federal": -0.2, "private": 0.3},
    "b_proc": {"open": 0.0, "invited": 0.4},
    "b_trade": {"243": 0.0, "244": 0.1, "245": -0.1, "250": 0.05},
    "sigma": 0.5,
    "cost_efficiency_mean": 0.92,
    "cost_efficiency_sd": 0.06,
}


def generate(n: int = N_ROWS, seed: int = SEED) -> list[dict]:
    """One dict per past bid with every column in schema.py, including `won`."""
    raise NotImplementedError("dataset generator, outside the model task (plan §2)")


def write_csv(rows: list[dict], path: Path) -> None:
    raise NotImplementedError("dataset generator, outside the model task (plan §2)")
