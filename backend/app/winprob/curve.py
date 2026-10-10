"""Margin grid -> offer -> price position -> win probability -> expected profit; scenarios (plan §8)."""

from __future__ import annotations

from statistics import NormalDist

import numpy as np
import pandas as pd

from app.pricing.engine import round_up

from .model import LogisticWinModel
from .schema import TenderContext

MIN_MARGIN_PCT = 2.0
NEAR_OPTIMAL_SHARE = 0.9


def win_curve(model: LogisticWinModel, ctx: TenderContext, baseline: float,
              grid: tuple[float, float, float] = (0.0, 20.0, 0.1), band: float = 0.8) -> pd.DataFrame:
    """Margin grid (default 0-20 % in 0.1 % steps, 201 points); offer = baseline / (1 - margin)."""
    start, stop, step = grid
    margin = np.round(np.arange(start, stop + step / 1000, step), 4)
    offer = baseline / (1 - margin / 100)
    p = model.predict(offer, ctx)
    low, high = model.predict_band(offer, ctx, z=NormalDist().inv_cdf(0.5 + band / 2))
    return pd.DataFrame({
        "margin_pct": margin,
        "offer": offer,
        "price_position": offer / ctx.market_reference_chf,
        "win_probability": p,
        "p_low": low,
        "p_high": high,
        "expected_profit": p * (offer - baseline),
    })


def scenarios(curve: pd.DataFrame, model: LogisticWinModel, ctx: TenderContext, baseline: float, round_to_chf: float,
              min_margin_pct: float = MIN_MARGIN_PCT, near_optimal_share: float = NEAR_OPTIMAL_SHARE) -> list[dict]:
    """Aggressive / Target / Conservative from points with margin >= min_margin_pct."""
    pts = curve[curve["margin_pct"] >= min_margin_pct]
    best = pts["expected_profit"].max()
    near = pts[pts["expected_profit"] >= near_optimal_share * best]
    picks = {
        "Aggressive": near["offer"].min(),
        "Target": pts.loc[pts["expected_profit"].idxmax(), "offer"],
        "Conservative": near["offer"].max(),
    }
    out = []
    for name, offer in picks.items():
        offer = round_up(float(offer), round_to_chf)
        p = float(model.predict(np.array([offer]), ctx)[0])
        out.append({
            "name": name,
            "offer": offer,
            "margin_pct": 100 * (1 - baseline / offer),
            "win_probability": p,
            "expected_profit": p * (offer - baseline),
        })
    return out
