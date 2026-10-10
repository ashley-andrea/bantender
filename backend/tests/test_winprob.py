import numpy as np
import pandas as pd
import pytest

pytest.importorskip("sklearn")

from app.winprob.curve import scenarios, win_curve
from app.winprob.demo_data import make_history
from app.winprob.explain import global_importance, tender_breakdown
from app.winprob.model import evaluate, train
from app.winprob.schema import TenderContext, load_history

BASELINE = 414_489.12


@pytest.fixture(scope="module")
def history(tmp_path_factory):
    path = tmp_path_factory.mktemp("wp") / "h.csv"
    make_history(800).to_csv(path, index=False)
    return load_history(path)


@pytest.fixture(scope="module")
def trained(history, ref):
    return evaluate(history, ref.parameters)


@pytest.fixture
def ctx():
    return TenderContext(
        bkp_trade="244", building_type="school", canton="ZH", client_type="municipality", procedure="open",
        market_reference_chf=460_000, price_weight_pct=60, zero_at_ratio=1.5, n_bidders=6,
        competitive_intensity=3.5, strategic_appetite=3, available_capacity_pct=60, technical_score_expected=3.5,
    )


def test_loader_rejects_missing_column_and_bad_value(tmp_path):
    df = make_history(50)
    df.drop(columns=["won"]).to_csv(tmp_path / "a.csv", index=False)
    with pytest.raises(ValueError, match="missing column"):
        load_history(tmp_path / "a.csv")
    df.assign(competitive_intensity=9).to_csv(tmp_path / "b.csv", index=False)
    with pytest.raises(ValueError, match="competitive_intensity"):
        load_history(tmp_path / "b.csv")


def test_training_is_deterministic(history):
    a, b = train(history), train(history)
    assert np.allclose(a._clf.coef_, b._clf.coef_)


def test_model_quality(trained):
    _, _, report = trained
    assert report["monotone"]
    assert report["ml"]["auc"] >= 0.70
    assert report["ml"]["log_loss"] < report["placeholder"]["log_loss"]


def test_no_effect_features_rank_below_real_ones(trained):
    model, test, _ = trained
    rank = [d["feature"] for d in global_importance(model, test)]
    assert rank.index("price_position") < rank.index("canton")
    assert rank.index("price_position") < rank.index("n_lots")


def test_curve_is_monotone_with_ordered_band(trained, ctx):
    model = trained[0]
    rng = np.random.default_rng(0)
    for _ in range(20):
        c = ctx.model_copy(update={"n_bidders": int(rng.integers(2, 11)), "price_weight_pct": float(rng.choice([40, 70]))})
        curve = win_curve(model, c, BASELINE)
        assert len(curve) == 201
        assert (np.diff(curve["win_probability"]) <= 1e-12).all()
        assert (curve["p_low"] <= curve["win_probability"] + 1e-12).all()
        assert (curve["win_probability"] <= curve["p_high"] + 1e-12).all()


def test_scenarios(trained, ctx):
    model = trained[0]
    curve = win_curve(model, ctx, BASELINE)
    a, t, c = scenarios(curve, model, ctx, BASELINE, 1000)
    assert a["offer"] <= t["offer"] <= c["offer"]
    assert all(s["margin_pct"] >= 1.9 and s["offer"] % 1000 == 0 for s in (a, t, c))
    pts = curve[curve["margin_pct"] >= 2]
    assert abs(t["offer"] - np.ceil(pts.loc[pts["expected_profit"].idxmax(), "offer"] / 1000) * 1000) < 1e-6


def test_tender_breakdown_covers_all_features(trained, ctx):
    rows = tender_breakdown(trained[0], ctx, 480_000)
    assert len(rows) == 17 and isinstance(pd.DataFrame(rows), pd.DataFrame)
