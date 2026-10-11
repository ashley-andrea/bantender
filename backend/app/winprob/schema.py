"""Data contract, derived features and TenderContext (plan §4, §5)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from pydantic import BaseModel

CATEGORICAL = ["bkp_trade", "building_type", "canton", "client_type", "procedure", "trade_building"]
NUMERIC = [
    "price_position",
    "price_position_x_sensitivity",
    "price_sensitivity",
    "log_project_cost",
    "n_lots",
    "log_n_bidders",
    "competitive_intensity",
    "strategic_appetite",
    "available_capacity_pct",
    "incumbent_present",
    "prior_wins_capped",
    "technical_score_expected",
]
FEATURES = CATEGORICAL + NUMERIC

# column -> allowed values (set) or (min, max) range; None = open bound
_RULES: dict[str, set | tuple] = {
    "bkp_trade": {"242", "243", "244", "245", "246", "250"},
    "building_type": {"school", "hospital", "office", "residential", "industrial", "public_building"},
    "client_type": {"municipality", "canton", "federal", "private"},
    "procedure": {"open", "invited"},
    "n_lots": (1, None),
    "n_bidders": (1, None),
    "competitive_intensity": (1, 5),
    "strategic_appetite": (1, 5),
    "available_capacity_pct": (0, 100),
    "incumbent_present": {0, 1},
    "prior_wins_with_client": (0, None),
    "technical_score_expected": (1, 5),
    "baseline_cost_chf": (0, None),
    "bid_price_chf": (0, None),
    "won": {0, 1},
}
HISTORY_COLUMNS = ["bid_id", "bid_date", "canton", "margin_pct", "price_weight_pct", "zero_at_ratio", *_RULES]
SNAPSHOT_COLUMNS = ["snapshot_date", "competitive_intensity", "strategic_appetite", "available_capacity_pct"]


class TenderContext(BaseModel):
    """Every feature input of a new tender except the offer. `baseline_cost_chf` (our full cost) comes from the pricing engine."""

    bkp_trade: str
    building_type: str
    canton: str
    client_type: str
    procedure: str
    baseline_cost_chf: float
    n_lots: int = 1
    price_weight_pct: float | None = None  # None = tender states no award rule
    zero_at_ratio: float | None = None
    n_bidders: int
    competitive_intensity: float
    strategic_appetite: float
    available_capacity_pct: float
    incumbent_present: int = 0
    prior_wins_with_client: int = 0
    technical_score_expected: float


def _check(df: pd.DataFrame, rules: dict, name: str) -> None:
    for col, rule in rules.items():
        if isinstance(rule, set):
            bad = ~df[col].isin(rule)
        else:
            lo, hi = rule
            bad = df[col].isna()
            bad |= df[col] <= lo if col in ("baseline_cost_chf", "bid_price_chf") else df[col] < lo
            if hi is not None:
                bad |= df[col] > hi
        if bad.any():
            raise ValueError(f"{name}: column '{col}' has {int(bad.sum())} invalid value(s), first at row {int(bad.idxmax())}")


def _read(path: Path, columns: list[str], name: str, date_col: str) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"bkp_trade": str}, parse_dates=[date_col])
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise ValueError(f"{name}: missing column(s) {missing}")
    return df


def load_history(path: Path) -> pd.DataFrame:
    df = _read(path, HISTORY_COLUMNS, "historical_bids", "bid_date")
    if df["bid_id"].duplicated().any():
        raise ValueError("historical_bids: bid_id is not unique")
    _check(df, _RULES, "historical_bids")
    rule = df[["price_weight_pct", "zero_at_ratio"]].dropna()  # empty = no award rule stated
    if ((rule["price_weight_pct"] < 0) | (rule["price_weight_pct"] > 100) | (rule["zero_at_ratio"] <= 1)).any():
        raise ValueError("historical_bids: price_weight_pct must be in 0-100 and zero_at_ratio > 1")
    return df.sort_values("bid_date").reset_index(drop=True)


def load_snapshots(path: Path) -> pd.DataFrame:
    df = _read(path, SNAPSHOT_COLUMNS, "market_snapshots", "snapshot_date")
    rules = {"competitive_intensity": (1, 5), "strategic_appetite": (1, 5), "available_capacity_pct": (0, 100)}
    _check(df, rules, "market_snapshots")
    return df.sort_values("snapshot_date").reset_index(drop=True)


def raw_sensitivity(df: pd.DataFrame) -> pd.Series:
    """Price points lost per 1 % above the lowest offer; NaN when the award rule is missing."""
    return df["price_weight_pct"] / ((df["zero_at_ratio"] - 1) * 100)


def add_features(df: pd.DataFrame, default_sensitivity: float) -> pd.DataFrame:
    """Same code for training and prediction. Needs bid_price_chf plus the raw contract columns."""
    out = df.copy()
    out["price_position"] = out["bid_price_chf"] / out["baseline_cost_chf"]  # our offer ÷ our cost (= 1 / (1 − margin))
    out["price_sensitivity"] = raw_sensitivity(out).fillna(default_sensitivity)
    out["price_position_x_sensitivity"] = (out["price_position"] - 1) * out["price_sensitivity"]
    out["log_project_cost"] = np.log(out["baseline_cost_chf"])
    out["trade_building"] = out["bkp_trade"].astype(str) + "×" + out["building_type"].astype(str)
    out["log_n_bidders"] = np.log(out["n_bidders"])
    out["prior_wins_capped"] = out["prior_wins_with_client"].clip(upper=3)
    return out
