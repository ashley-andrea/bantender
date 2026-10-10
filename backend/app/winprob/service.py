"""Model lifecycle: train at API start, fall back to the placeholder (plan §10, step 5)."""

from __future__ import annotations

from pathlib import Path

from app.reference.models import ProjectParameters

from .model import WinModel


def get_win_model(history_csv: Path, cache_dir: Path, params: ProjectParameters, mode: str = "ml") -> WinModel:
    """`mode="placeholder"`, missing sklearn, or a training error → PlaceholderWinModel."""
    raise NotImplementedError("Step 5 in docs/win-probability-model.md")
