"""Global feature relevance and per-tender breakdown (plan §9). The optional OpenAI summary is not implemented."""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance

from .model import SEED, LogisticWinModel, _sigmoid
from .schema import CATEGORICAL, FEATURES, NUMERIC, TenderContext


def global_importance(model: LogisticWinModel, test: pd.DataFrame) -> list[dict]:
    """Permutation importance (log loss increase) on held-out rows, ranked. Sign is the weight sign for numerics."""
    r = permutation_importance(
        model.pipeline, test[FEATURES], test["won"], scoring="neg_log_loss", n_repeats=10, random_state=SEED
    )
    rows = [
        {
            "feature": f,
            "importance": float(r.importances_mean[i]),
            "effect": "categorical" if f in CATEGORICAL else ("+" if model.weight(f"num__{f}") > 0 else "-"),
        }
        for i, f in enumerate(FEATURES)
    ]
    return sorted(rows, key=lambda d: -d["importance"])


def tender_breakdown(model: LogisticWinModel, ctx: TenderContext, offer: float) -> list[dict]:
    """Points of win probability each feature adds vs the average tender, at this offer."""
    frame = model.frame(np.array([offer]), ctx)
    pre = model.pipeline.named_steps["features"]
    x = pre.transform(frame[FEATURES])[0]
    contrib = model._clf.coef_[0] * (x - model.x_mean)
    base = model._clf.intercept_[0] + model._clf.coef_[0] @ model.x_mean
    per_feature: dict[str, float] = {}
    for name, c in zip(pre.get_feature_names_out(), contrib):
        kind, col = name.split("__", 1)
        key = col if kind == "num" else next(f for f in CATEGORICAL if col.startswith(f + "_"))
        per_feature[key] = per_feature.get(key, 0.0) + float(c)
    out = [
        {"feature": f, "value": frame[f].iloc[0].item() if f in NUMERIC else frame[f].iloc[0], "pts": 100 * float(_sigmoid(base + c) - _sigmoid(base))}
        for f, c in per_feature.items()
    ]
    return sorted(out, key=lambda d: -abs(d["pts"]))
