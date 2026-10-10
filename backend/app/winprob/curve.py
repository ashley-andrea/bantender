"""Margin grid → bid price → price position → win probability → expected profit (PLAN.md §7)."""

from __future__ import annotations

from .model import WinModel
from .schema import CurvePoint, TenderContext


def margin_grid(start_pct: float = 0.0, stop_pct: float = 20.0, step_pct: float = 0.5) -> list[float]:
    raise NotImplementedError("Step 3 in PLAN.md")


def win_curve(baseline: float, context: TenderContext, model: WinModel, margins: list[float], round_to_chf: float) -> list[CurvePoint]:
    """Bid price uses the engine's formula: round_up(baseline / (1 − m), round_to_chf)."""
    raise NotImplementedError("Step 3 in PLAN.md")
