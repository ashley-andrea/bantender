"""Logistic win model, training, evaluation, monotonicity check, uncertainty band (plan §6)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.pricing.scenarios import win_probability
from app.reference.models import ProjectParameters

from .schema import CATEGORICAL, FEATURES, NUMERIC, TenderContext, add_features, raw_sensitivity

SEED = 42
Z80 = 1.2816  # 80 % two-sided band


def _sigmoid(x):
    return 1 / (1 + np.exp(-x))


def _pipeline() -> Pipeline:
    features = ColumnTransformer(
        [("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL), ("num", StandardScaler(), NUMERIC)],
        sparse_threshold=0,
    )
    return Pipeline([("features", features), ("clf", LogisticRegression(max_iter=1000, random_state=SEED))])


class LogisticWinModel:
    name = "ml"

    def __init__(self, pipeline: Pipeline, x_train: np.ndarray, default_sensitivity: float, sens_range: tuple, version: str):
        self.pipeline, self.version = pipeline, version
        self.default_sensitivity, self.sens_range = default_sensitivity, sens_range
        self.x_mean = x_train.mean(axis=0)  # transformed-feature means, for per-tender explanations
        self.cov = self._weight_covariance(x_train)

    @property
    def _clf(self) -> LogisticRegression:
        return self.pipeline.named_steps["clf"]

    def _weight_covariance(self, x: np.ndarray) -> np.ndarray:
        """Laplace approximation: inverse Hessian of the regularised log loss, intercept included."""
        xi = np.hstack([x, np.ones((len(x), 1))])
        p = self._clf.predict_proba(x)[:, 1]
        penalty = np.eye(xi.shape[1])
        penalty[-1, -1] = 0
        hessian = self._clf.C * (xi.T * (p * (1 - p))) @ xi + penalty
        return np.linalg.inv(hessian)

    def frame(self, offers: np.ndarray, ctx: TenderContext) -> pd.DataFrame:
        """One row per offer, with all model features."""
        row = ctx.model_dump()
        df = pd.DataFrame([row] * len(offers))
        df["bid_price_chf"] = np.asarray(offers, dtype=float)
        df = df.assign(price_weight_pct=df["price_weight_pct"].astype(float), zero_at_ratio=df["zero_at_ratio"].astype(float))
        return add_features(df, self.default_sensitivity)

    def predict(self, offers: np.ndarray, ctx: TenderContext) -> np.ndarray:
        return self.pipeline.predict_proba(self.frame(offers, ctx)[FEATURES])[:, 1]

    def predict_band(self, offers: np.ndarray, ctx: TenderContext) -> tuple[np.ndarray, np.ndarray]:
        x = self.pipeline.named_steps["features"].transform(self.frame(offers, ctx)[FEATURES])
        xi = np.hstack([x, np.ones((len(x), 1))])
        logit = xi[:, :-1] @ self._clf.coef_[0] + self._clf.intercept_[0]
        sd = np.sqrt(np.einsum("ij,jk,ik->i", xi, self.cov, xi))
        return _sigmoid(logit - Z80 * sd), _sigmoid(logit + Z80 * sd)

    def weight(self, name: str) -> float:
        names = self.pipeline.named_steps["features"].get_feature_names_out()
        return float(self._clf.coef_[0][list(names).index(name)])

    def is_monotone(self) -> bool:
        """d logit / d price_position < 0 at both ends of the training sensitivity range (plan §6.3)."""
        scaler = self.pipeline.named_steps["features"].named_transformers_["num"]
        sd = dict(zip(NUMERIC, scaler.scale_))
        w_pp, w_int = self.weight("num__price_position"), self.weight("num__price_position_x_sensitivity")
        return all(w_pp / sd["price_position"] + w_int * s / sd["price_position_x_sensitivity"] < 0 for s in self.sens_range)


def history_version(history_csv: Path) -> str:
    return "logreg-" + hashlib.sha256(history_csv.read_bytes()).hexdigest()[:8]


def train(history: pd.DataFrame, version: str = "logreg") -> LogisticWinModel:
    """Fit on all given rows; deterministic."""
    sens = raw_sensitivity(history)
    default = float(sens.mean())
    data = add_features(history, default)
    pipe = _pipeline().fit(data[FEATURES], data["won"])
    x = pipe.named_steps["features"].transform(data[FEATURES])
    sens_filled = data["price_sensitivity"]
    return LogisticWinModel(pipe, x, default, (float(sens_filled.min()), float(sens_filled.max())), version)


def split_by_time(history: pd.DataFrame, test_months: int = 6) -> tuple[pd.DataFrame, pd.DataFrame]:
    cutoff = history["bid_date"].max() - pd.DateOffset(months=test_months)
    return history[history["bid_date"] <= cutoff], history[history["bid_date"] > cutoff]


def placeholder_probabilities(history: pd.DataFrame, params: ProjectParameters) -> np.ndarray:
    """Equans placeholder on past bids; reference price = our price at the target margin."""
    target = params.commercial.target_margin_pct / 100
    return np.array([win_probability(r.bid_price_chf, r.baseline_cost_chf / (1 - target), params) for r in history.itertuples()])


def _metrics(y: np.ndarray, p: np.ndarray) -> dict:
    return {"auc": roc_auc_score(y, p), "brier": brier_score_loss(y, p), "log_loss": log_loss(y, np.clip(p, 1e-6, 1 - 1e-6))}


def calibration(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    """Mean predicted vs observed win rate in equal-count probability bins."""
    df = pd.DataFrame({"y": y, "p": p})
    df["bin"] = pd.qcut(df["p"].rank(method="first"), bins, labels=False)
    g = df.groupby("bin").agg(n=("y", "size"), predicted=("p", "mean"), observed=("y", "mean"))
    return g.reset_index(drop=True).to_dict("records")


def evaluate(history: pd.DataFrame, params: ProjectParameters, test_months: int = 6) -> tuple[LogisticWinModel, pd.DataFrame, dict]:
    """Train on everything before the last `test_months`, score the rest. Returns (model, test features, report)."""
    train_df, test_df = split_by_time(history, test_months)
    model = train(train_df)
    test = add_features(test_df, model.default_sensitivity)
    y = test["won"].to_numpy()
    p_ml = model.pipeline.predict_proba(test[FEATURES])[:, 1]
    p_ph = placeholder_probabilities(test_df, params)
    report = {
        "rows": {"train": len(train_df), "test": len(test_df)},
        "date_range": [str(history["bid_date"].min().date()), str(history["bid_date"].max().date())],
        "win_rate": {"train": float(train_df["won"].mean()), "test": float(y.mean())},
        "ml": _metrics(y, p_ml),
        "placeholder": _metrics(y, p_ph),
        "calibration": calibration(y, p_ml),
        "monotone": model.is_monotone(),
    }
    return model, test, report
