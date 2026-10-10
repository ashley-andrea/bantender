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


PRICE_FEATURES = ("price_position", "price_position_x_sensitivity")  # the only features that move with the offer


def shap_values(model: LogisticWinModel, ctx: TenderContext, offers: np.ndarray) -> tuple[float, pd.DataFrame]:
    """Exact SHAP values in log-odds, one row per offer and one column per model feature (one-hot columns summed).

    For a linear model with the training set as background, SHAP_j = w_j · (x_j − mean_j) on the transformed
    features. Additive: base + row sum = the model's logit at that offer.
    """
    pre = model.pipeline.named_steps["features"]
    x = pre.transform(model.frame(offers, ctx)[FEATURES])
    contrib = model._clf.coef_[0] * (x - model.x_mean)
    base = float(model._clf.intercept_[0] + model._clf.coef_[0] @ model.x_mean)
    cols: dict[str, np.ndarray] = {f: np.zeros(len(offers)) for f in FEATURES}
    for j, name in enumerate(pre.get_feature_names_out()):
        kind, col = name.split("__", 1)
        cols[col if kind == "num" else next(f for f in CATEGORICAL if col.startswith(f + "_"))] += contrib[:, j]
    return base, pd.DataFrame(cols)
