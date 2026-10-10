"""Win models: the learned one and the Equans placeholder behind one interface."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.pricing.scenarios import win_probability
from app.reference.models import ProjectParameters

from .schema import TenderContext


class WinModel(Protocol):
    name: str
    version: str

    def predict(self, bid_price: float, baseline: float, context: TenderContext) -> float:
        """Probability in [0, 1] that this bid wins."""
        ...


class PlaceholderWinModel:
    """Fallback: the linear model in project_parameters.json (reference = our price at the target margin)."""

    name = "placeholder"
    version = "equans-v1"

    def __init__(self, params: ProjectParameters):
        self.params = params

    def predict(self, bid_price: float, baseline: float, context: TenderContext) -> float:
        reference_price = baseline / (1 - self.params.commercial.target_margin_pct / 100)
        return win_probability(bid_price, reference_price, self.params)


class LogisticWinModel:
    """One-hot categoricals + scaled numerics + LogisticRegression (plan step 2)."""

    name = "ml"

    def __init__(self, pipeline, version: str):
        self.pipeline = pipeline
        self.version = version

    def predict(self, bid_price: float, baseline: float, context: TenderContext) -> float:
        raise NotImplementedError("Step 2 in docs/win-probability-model.md")


def train(history_csv: Path) -> LogisticWinModel:
    """Fit on the history with a time-based split (by bid_date); seeded and deterministic."""
    raise NotImplementedError("Step 2 in docs/win-probability-model.md")


def evaluate(model: LogisticWinModel, history_csv: Path) -> dict:
    """AUC, Brier, log loss and calibration bins on the held-out (latest) bids."""
    raise NotImplementedError("Step 2 in docs/win-probability-model.md")
