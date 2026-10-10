"""Bid scenarios (Recommended Bid Range) and tender award points.

The win-probability model is the placeholder supplied by Equans in
project_parameters.json; it reproduces expected_output_example.json exactly.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.reference.models import ProjectParameters

from .engine import round_up


@dataclass(frozen=True)
class Scenario:
    name: str
    margin_pct: float
    bid_price: float
    win_probability: float
    expected_contribution: float


def win_probability(bid: float, reference_price: float, params: ProjectParameters) -> float:
    b = params.stretch_bid_optimization
    p = (
        b.reference_win_probability
        + b.strategic_appetite_adjustment
        + b.competition_adjustment
        - b.price_sensitivity_probability_points_per_1pct_price * (bid / reference_price - 1) * 100
    )
    return min(max(p, b.minimum_probability), b.maximum_probability)


def bid_scenarios(baseline: float, params: ProjectParameters) -> list[Scenario]:
    cm, b = params.commercial, params.stretch_bid_optimization
    reference_price = baseline / (1 - cm.target_margin_pct / 100)
    out = []
    for name in b.scenario_names:
        margin = b.scenario_margins_pct[name]
        bid = round_up(baseline / (1 - margin / 100), cm.round_to_chf)
        p = win_probability(bid, reference_price, params)
        out.append(Scenario(name, margin, bid, p, (bid - baseline) * p))
    return out


def award_price_points(price: float, lowest_price: float, weight: float, zero_at_ratio: float) -> float:
    """Linear price scoring: full weight at the lowest offer, 0 at zero_at_ratio × the lowest (both read from the tender)."""
    share = max(0.0, 1 - (price / lowest_price - 1) / (zero_at_ratio - 1))
    return weight * min(share, 1.0)
