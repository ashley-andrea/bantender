"""Win probability per margin, learned from (synthetic) bid history. Plan and status: PLAN.md."""

from .curve import margin_grid, win_curve
from .model import LogisticWinModel, PlaceholderWinModel, WinModel
from .schema import CurvePoint, TenderContext
from .service import get_win_model

__all__ = [
    "CurvePoint", "LogisticWinModel", "PlaceholderWinModel", "TenderContext", "WinModel",
    "get_win_model", "margin_grid", "win_curve",
]
