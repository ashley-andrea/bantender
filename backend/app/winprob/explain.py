"""Plain-language explanation of the win curve via OpenAI (plan §9, step 4). Only curve numbers leave the server."""

from __future__ import annotations

from .schema import CurvePoint, TenderContext


def explain_curve(points: list[CurvePoint], context: TenderContext, language: str = "en") -> str | None:
    """None when ai_provider is "off" or the budget is exhausted."""
    raise NotImplementedError("Step 4 in docs/win-probability-model.md")
