"""Win model in the running system: train at API start, fall back to the placeholder, build each tender's curve (plan §7, §10, §11).

numpy / pandas / scikit-learn are imported lazily: without the `winprob` extra the API still starts and prices tenders;
the pricing result then says the win curve is unavailable.
"""

from __future__ import annotations

import csv
import json
import logging
import math
import re
from pathlib import Path

from app.reference.models import ProjectParameters

log = logging.getLogger(__name__)

# Building type from words in the project name ("SH" = Schulhaus). First match wins.
BUILDING_WORDS = [
    ("school", r"schul|\bsh\b|kindergarten|primar|sekundar|gymnasium"),
    ("hospital", r"spital|klinik|pflege|alters"),
    ("residential", r"wohn|überbauung|mfh\b"),
    ("industrial", r"industrie|werk\b|produktion|lager"),
    ("office", r"büro|buero|office|geschäftshaus"),
    ("public_building", r"verwaltung|gemeindehaus|turnhalle|sporthalle|museum|bibliothek"),
]
SNAPSHOT_FIELDS = ("competitive_intensity", "strategic_appetite", "available_capacity_pct")


def _clean(v):
    """JSON-safe scalars (numpy → Python, NaN → None, floats rounded for transport)."""
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float):
        return None if math.isnan(v) else round(v, 6)
    return v


class WinService:
    """One per process. `curve()` is called on every pricing request; it never raises."""

    def __init__(self, reference_dir: Path, params: ProjectParameters, context_path: Path | None, mode: str = "ml"):
        self.params = params
        self.history_csv = reference_dir / "historical_bids.csv"
        self.snapshots_csv = reference_dir / "market_snapshots.csv"
        self.fixture = json.loads(context_path.read_text(encoding="utf-8")) if context_path and context_path.exists() else {}
        self.snapshot = self._latest_snapshot()
        self.model = None  # LogisticWinModel when the learned model is in use
        self.kind = "unavailable"  # ml | placeholder | unavailable
        self.reason: str | None = None
        self.report: dict = {}
        self._start(mode)

    # ---- startup -----------------------------------------------------------------------------

    def _start(self, mode: str) -> None:
        try:
            import numpy  # noqa: F401
            import pandas  # noqa: F401
            import sklearn  # noqa: F401
        except ImportError as e:
            self.reason = f"win-probability libraries not installed ({e.name}); install the 'winprob' extra"
            log.warning(self.reason)
            return
        self.kind = "placeholder"
        if mode == "placeholder":
            self.reason = "WIN_MODEL=placeholder"
            return
        if not self.history_csv.exists():
            self.reason = f"no bid history at {self.history_csv}"
            return
        try:
            from .explain import global_importance
            from .model import evaluate, history_version, train
            from .schema import load_history

            history = load_history(self.history_csv)
            held_out, test, report = evaluate(history, self.params)
            report["importance"] = global_importance(held_out, test)
            model = train(history, history_version(self.history_csv))
            if not model.is_monotone():
                self.reason = "trained model is not monotone in price; using the placeholder"
                self.report = report
                return
        except Exception as e:  # invalid data, training failure: the API must still start
            self.reason = f"training failed: {e}"
            log.exception("win model training failed")
            return
        self.model, self.kind, self.report = model, "ml", report

    def _latest_snapshot(self) -> dict:
        if not self.snapshots_csv.exists():
            return {}
        with self.snapshots_csv.open(encoding="utf-8") as fh:
            rows = sorted(csv.DictReader(fh), key=lambda r: r["snapshot_date"])
        return rows[-1] if rows else {}

    # ---- per tender --------------------------------------------------------------------------

    def context_fields(self) -> set[str]:
        from .schema import TenderContext
        return set(TenderContext.model_fields)

    def check_override(self, win_context: dict) -> None:
        """Raise ValueError for unknown or invalid estimator inputs (used by PATCH settings)."""
        if self.kind == "unavailable":
            return
        unknown = set(win_context) - (self.context_fields() - {"baseline_cost_chf"})  # our cost comes from the pricing engine
        if unknown:
            raise ValueError(f"Unknown win_context fields: {sorted(unknown)}")
        from .schema import TenderContext
        TenderContext.model_validate({**self._defaults(), "baseline_cost_chf": 1.0, **win_context})

    def _defaults(self) -> dict:
        """Fixture + latest snapshot: the base a partial estimator override is validated against."""
        return {**self.fixture, **{k: float(self.snapshot[k]) for k in SNAPSHOT_FIELDS if k in self.snapshot}}

    def context(self, parsed: dict, settings: dict) -> tuple[dict, dict]:
        """(values, sources). Sources: tender (parser) · market_snapshot · demo_fixture (stand-in for ingestion) · estimator."""
        values, sources = {}, {}

        def put(key, value, source):
            if value is not None:
                values[key], sources[key] = value, source

        for k, v in self.fixture.items():
            put(k, v, "demo_fixture")
        for k in SNAPSHOT_FIELDS:
            if k in self.snapshot:
                put(k, float(self.snapshot[k]), "market_snapshot")
        project = parsed.get("project") or {}
        put("bkp_trade", project.get("bkp"), "tender")
        name = (project.get("name") or "").lower()
        put("building_type", next((b for b, rx in BUILDING_WORDS if re.search(rx, name)), None), "tender")
        award = parsed.get("award") or {}
        if award.get("weight") and award.get("zero_at_ratio"):
            put("price_weight_pct", float(award["weight"]), "tender")
            put("zero_at_ratio", float(award["zero_at_ratio"]), "tender")
        if parsed.get("lots"):
            put("n_lots", len(parsed["lots"]), "tender")
        for k, v in (settings.get("win_context") or {}).items():
            put(k, v, "estimator")
        return values, sources

    def curve(self, baseline: float, selling_price: float, parsed: dict, settings: dict) -> dict:
        """The `win_curve` block of the pricing result. Never raises: errors become {"model": "error", ...}."""
        if self.kind == "unavailable":
            return {"model": "unavailable", "reason": self.reason}
        try:
            return self._curve(baseline, selling_price, parsed, settings)
        except Exception as e:
            log.exception("win curve failed")
            return {"model": "error", "reason": str(e)}

    def _curve(self, baseline: float, selling_price: float, parsed: dict, settings: dict) -> dict:
        import numpy as np

        from .curve import scenarios, win_curve
        from .explain import PRICE_FEATURES, shap_values, tender_breakdown
        from .model import PlaceholderWinModel
        from .schema import TenderContext

        wm, cm = self.params.win_model, self.params.commercial
        values, sources = self.context(parsed, settings)
        values["baseline_cost_chf"], sources["baseline_cost_chf"] = baseline, "pricing"
        ctx = TenderContext.model_validate(values)

        model = self.model if self.kind == "ml" else PlaceholderWinModel(self.params, baseline)
        grid = (wm.margin_grid_pct.start, wm.margin_grid_pct.stop, wm.margin_grid_pct.step)
        points = win_curve(model, ctx, baseline, grid=grid, band=wm.band)
        picks = scenarios(points, model, ctx, baseline, cm.round_to_chf, wm.min_margin_pct, wm.priority_weight)

        p_now = float(model.predict(np.array([selling_price]), ctx)[0])
        lo_now, hi_now = (float(a[0]) for a in model.predict_band(np.array([selling_price]), ctx))
        target_offer = next(s["offer"] for s in picks if s["name"] == "Target")
        explanation = tender_breakdown(model, ctx, target_offer) if self.kind == "ml" else []
        shap = None
        if self.kind == "ml":  # exact SHAP (log-odds): fixed per tender, except the price features, which follow the offer
            base, sv = shap_values(model, ctx, points["offer"].to_numpy())
            fixed = {f: _clean(sv[f].iloc[0]) for f in sv.columns if f not in PRICE_FEATURES}
            for f in PRICE_FEATURES:
                points[f"shap_{f}"] = sv[f].to_numpy()
            shap = {"base": base, "fixed": fixed, "per_point": [f"shap_{f}" for f in PRICE_FEATURES]}

        return {
            "model": self.kind,
            "model_version": model.version,
            "reason": self.reason,
            "baseline": baseline,
            "context": {k: _clean(v) for k, v in ctx.model_dump().items()},
            "sources": {k: sources.get(k, "default") for k in ctx.model_dump()},
            "snapshot_date": self.snapshot.get("snapshot_date"),
            "parameters": {"margin_grid_pct": list(grid), "priority_weight": wm.priority_weight,
                           "min_margin_pct": wm.min_margin_pct, "band": wm.band, "round_to_chf": cm.round_to_chf},
            "points": [{k: _clean(v) for k, v in row.items()} for row in points.to_dict("records")],
            "scenarios": [{k: _clean(v) for k, v in s.items()} for s in picks],
            "current": {"offer": selling_price, "margin_pct": 100 * (1 - baseline / selling_price),
                        "win_probability": p_now, "p_low": lo_now, "p_high": hi_now,
                        "expected_profit": p_now * (selling_price - baseline)},
            "explanation": [{k: _clean(v) for k, v in d.items()} for d in explanation],
            "shap": shap,
        }

    # ---- model card --------------------------------------------------------------------------

    def summary(self) -> dict:
        """For GET /api/win-model: what the model is, the data behind it, how well it does, what drives it."""
        r = self.report
        return {
            "model": self.kind,
            "model_version": self.model.version if self.model else None,
            "reason": self.reason,
            "history": str(self.history_csv.name),
            "rows": r.get("rows"),
            "date_range": r.get("date_range"),
            "win_rate": r.get("win_rate"),
            "metrics": {"ml": r.get("ml"), "placeholder": r.get("placeholder")},
            "calibration": r.get("calibration"),
            "monotone": r.get("monotone"),
            "importance": r.get("importance"),
            "latest_snapshot": self.snapshot or None,
            "parameters": self.params.win_model.model_dump(),
        }
