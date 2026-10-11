"""Margin grid -> offer -> price position -> win probability -> expected profit; scenarios (plan §8)."""

from __future__ import annotations

from statistics import NormalDist

import numpy as np
import pandas as pd

from app.pricing.engine import round_up

from .model import LogisticWinModel
from .schema import TenderContext

MIN_MARGIN_PCT = 2.0
PRIORITY_WEIGHT = 2.0  # how much more the outer options weigh winning (Aggressive) or profit per job (Conservative)


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
        "price_position": offer / ctx.baseline_cost_chf,
        "win_probability": p,
        "p_low": low,
        "p_high": high,
        "expected_profit": p * (offer - baseline),
    })


def scenarios(curve: pd.DataFrame, model: LogisticWinModel, ctx: TenderContext, baseline: float, round_to_chf: float,
              min_margin_pct: float = MIN_MARGIN_PCT, priority_weight: float = PRIORITY_WEIGHT) -> list[dict]:
    """Three attitudes, each the best offer for its own priority (points with margin >= min_margin_pct):

    - Target: highest expected profit, (offer − cost) × p
    - Aggressive: winning weighs more, (offer − cost) × p^w
    - Conservative: profit per job weighs more, (offer − cost)^w × p
    """
    pts = curve[curve["margin_pct"] >= min_margin_pct]
    gain, p, w = pts["offer"] - baseline, pts["win_probability"], priority_weight
    picks = {
        "Aggressive": pts.loc[(gain * p**w).idxmax(), "offer"],
        "Target": pts.loc[(gain * p).idxmax(), "offer"],
        "Conservative": pts.loc[(gain**w * p).idxmax(), "offer"],
    }
    out = []
    for name, offer in picks.items():
        offer = round_up(float(offer), round_to_chf)
        prob = float(model.predict(np.array([offer]), ctx)[0])
        out.append({
            "name": name,
            "offer": offer,
            # from a price 0.5 CHF below the offer: applying this margin (price = round_up(baseline / (1 − m)))
            # lands exactly on the offer instead of tipping into the next rounding step
            "margin_pct": 100 * (1 - baseline / (offer - 0.5)),
            "win_probability": prob,
            "expected_profit": prob * (offer - baseline),
        })
    return out
