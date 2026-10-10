"""Ceiling check: AUC of the true win probability vs the trained model, on the same test split."""

import numpy as np
from sklearn.metrics import log_loss, roc_auc_score

from app.winprob.model import evaluate, split_by_time
from app.winprob.run import REFERENCE
from app.winprob.schema import load_history
from app.winprob.synthetic import generate, true_probability
from app.reference import load_reference

# regenerate with the same seed to access the hidden probability per bid
bids, _ = generate()
p_true = true_probability(bids)
won = bids["won"]
test = np.array([str(d) for d in bids["bid_date"]]) > "2026-03-30"  # last 6 months
print(f"test rows {test.sum()}")
print(f"true probability (noise-free) AUC {roc_auc_score(won[test], p_true[test]):.3f}  log loss {log_loss(won[test], p_true[test]):.3f}")

# many random draws of the outcome from the true probability -> typical ceiling and its spread
rng = np.random.default_rng(0)
aucs = [roc_auc_score(y, p_true[test]) for y in (rng.random((200, test.sum())) < p_true[test]).astype(int)]
print(f"AUC ceiling over 200 redraws of the outcome: mean {np.mean(aucs):.3f}, 5-95% {np.percentile(aucs, 5):.3f}-{np.percentile(aucs, 95):.3f}")

hist = load_history(REFERENCE / "historical_bids.csv")
model, _, rep = evaluate(hist, load_reference(REFERENCE).parameters)
print(f"trained model AUC {rep['ml']['auc']:.3f}  log loss {rep['ml']['log_loss']:.3f}")
