"""Compare candidate classifiers on the win-model split (same features, last 6 months as test)."""

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.winprob.model import split_by_time
from app.winprob.run import REFERENCE
from app.winprob.schema import CATEGORICAL, FEATURES, NUMERIC, add_features, load_history, raw_sensitivity

hist = load_history(REFERENCE / "historical_bids.csv")
tr, te = split_by_time(hist)
default = float(raw_sensitivity(tr).mean())
tr, te = add_features(tr, default), add_features(te, default)


def pipe(clf, scale):
    pre = ColumnTransformer(
        [("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL), ("num", StandardScaler() if scale else "passthrough", NUMERIC)],
        sparse_threshold=0,
    )
    return Pipeline([("f", pre), ("clf", clf)])


models = {
    "logreg": pipe(LogisticRegression(max_iter=1000), True),
    "logreg C=0.1": pipe(LogisticRegression(max_iter=1000, C=0.1), True),
    "random forest": pipe(RandomForestClassifier(500, min_samples_leaf=10, random_state=42, n_jobs=-1), False),
    "grad. boosting": pipe(HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, random_state=42), False),
}
print(f"{'model':<16} {'AUC':>6} {'Brier':>6} {'LogLoss':>8}")
for name, m in models.items():
    p = m.fit(tr[FEATURES], tr["won"]).predict_proba(te[FEATURES])[:, 1]
    print(f"{name:<16} {roc_auc_score(te['won'], p):6.3f} {brier_score_loss(te['won'], p):6.3f} {log_loss(te['won'], np.clip(p, 1e-6, 1 - 1e-6)):8.3f}")
