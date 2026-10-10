"""Model lifecycle: train at API start, cache by history hash, fall back to the placeholder (PLAN.md §4.2, step 4)."""

from __future__ import annotations

from pathlib import Path

from app.reference.models import ProjectParameters

from .model import WinModel


def get_win_model(history_csv: Path, cache_dir: Path, params: ProjectParameters, mode: str = "ml") -> WinModel:
    """`mode="placeholder"`, missing sklearn, or a training error → PlaceholderWinModel."""
    raise NotImplementedError("Step 4 in PLAN.md")
