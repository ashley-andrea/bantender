"""Column names and data contracts for the win-probability model (single source of truth; see the plan §4)."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel

TRADES = ("243", "244", "245", "250")
CLIENT_TYPES = ("municipality", "canton", "federal", "private")
CANTONS = ("ZH", "AG", "BE", "LU", "SG", "TG")
PROCEDURES = ("open", "invited")

CATEGORICAL_FEATURES = ["bkp_trade", "client_type", "canton", "procedure"]
NUMERIC_FEATURES = [
    "price_position",
    "log_market_reference",
    "n_lots",
    "price_weight_pct",
    "n_bidders",
    "competitive_intensity",
    "incumbent_present",
    "prior_wins_with_client",
    "strategic_appetite",
    "available_capacity_pct",
    "technical_score_expected",
]
FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES
TARGET = "won"

# Never model inputs: margin/baseline are ours, the rest is only known after the award.
NOT_FEATURES = ["bid_id", "bid_date", "margin_pct", "baseline_cost_chf", "bid_price_chf", "winning_price_chf", "our_rank"]


class TenderContext(BaseModel):
    """Inputs for a new tender, supplied by the (assumed) ingestion pipeline plus the parser."""

    bkp_trade: str
    client_type: str
    canton: str
    procedure: str
    market_reference_chf: float | None = None  # None → fallback, see the plan §7.1
    n_lots: int = 1
    price_weight_pct: float = 50.0
    n_bidders: int
    competitive_intensity: int
    incumbent_present: bool = False
    prior_wins_with_client: int = 0
    strategic_appetite: int = 3
    available_capacity_pct: float = 50.0
    technical_score_expected: float = 3.0


@dataclass(frozen=True)
class CurvePoint:
    margin_pct: float
    bid_price: float
    price_position: float
    win_probability: float
    expected_profit: float
