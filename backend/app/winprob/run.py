"""Train, evaluate and show the win model: `make winprob` (plan §6, §8, §9).

Uses data/reference/v2/historical_bids.csv; if it is not there yet, a synthetic demo history is generated.
Writes report.json and curve.csv to backend/benchmarks/results/winprob/.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.reference import load_reference

from .curve import scenarios, win_curve
from .demo_data import make_history
from .explain import global_importance, tender_breakdown
from .model import evaluate, history_version, train
from .schema import TenderContext, load_history

ROOT = Path(__file__).resolve().parents[3]
REFERENCE = ROOT / "data" / "reference" / "v2"
SAMPLE = ROOT / "data" / "samples" / "oberglatt"
OUT = ROOT / "backend" / "benchmarks" / "results" / "winprob"
BASELINE_CHF = 2_325_198.0  # cost baseline of the full Oberglatt tender at company defaults (the API computes it per tender)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--history", type=Path, default=REFERENCE / "historical_bids.csv")
    ap.add_argument("--context", type=Path, default=SAMPLE / "tender_context.json")
    ap.add_argument("--baseline", type=float, default=BASELINE_CHF, help="our full cost of the tender, CHF")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    history_csv = args.history
    if not history_csv.exists():
        history_csv = OUT / "demo_history.csv"
        make_history().to_csv(history_csv, index=False)
        print(f"No {args.history.name} found: using a SYNTHETIC demo history ({history_csv}).\n")

    params = load_reference(REFERENCE).parameters
    history = load_history(history_csv)
    ctx = TenderContext.model_validate_json(args.context.read_text(encoding="utf-8"))

    model, test, report = evaluate(history, params)
    report["importance"] = global_importance(model, test)

    final = train(history, history_version(history_csv))  # production model: all rows
    curve = win_curve(final, ctx, args.baseline)
    picks = scenarios(curve, final, ctx, args.baseline, params.commercial.round_to_chf)
    report["model_version"] = final.version
    report["scenarios"] = picks
    report["explanation"] = tender_breakdown(final, ctx, next(s for s in picks if s["name"] == "Target")["offer"])

    (OUT / "report.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    curve.to_csv(OUT / "curve.csv", index=False)
    show(report, curve)
    print(f"\nWrote {OUT / 'report.json'} and {OUT / 'curve.csv'}")


def show(report: dict, curve) -> None:
    r = report["rows"]
    print(f"Model {report['model_version']}: {r['train']} train / {r['test']} test bids, "
          f"{report['date_range'][0]} to {report['date_range'][1]}, monotone in price: {report['monotone']}")
    print(f"\nTest metrics        {'AUC':>7} {'Brier':>7} {'LogLoss':>8}")
    for k in ("ml", "placeholder"):
        m = report[k]
        print(f"  {k:<17} {m['auc']:7.3f} {m['brier']:7.3f} {m['log_loss']:8.3f}")
    print("\nCalibration (bin: predicted vs observed win rate)")
    print("  " + "  ".join(f"{c['predicted']:.2f}/{c['observed']:.2f}" for c in report["calibration"]))
    print("\nFeature importance (log-loss increase when shuffled)")
    for d in report["importance"]:
        print(f"  {d['feature']:<30} {d['importance']:8.4f}  {d['effect']}")
    print("\nWin curve (every 2 % margin)")
    print(f"  {'margin':>7} {'offer CHF':>11} {'P(win)':>7} {'80% band':>13} {'exp. profit':>12}")
    for row in curve[(curve["margin_pct"] * 10).round() % 20 == 0].itertuples():
        print(f"  {row.margin_pct:6.1f}% {row.offer:11,.0f} {row.win_probability:7.2f}  "
              f"[{row.p_low:.2f}-{row.p_high:.2f}] {row.expected_profit:12,.0f}")
    print("\nScenarios")
    for s in report["scenarios"]:
        print(f"  {s['name']:<13} offer {s['offer']:>9,.0f}  margin {s['margin_pct']:5.1f}%  "
              f"P(win) {s['win_probability']:.2f}  exp. profit {s['expected_profit']:>8,.0f}")
    print("\nWhy the Target probability (points vs the average tender)")
    for d in report["explanation"][:6]:
        print(f"  {d['feature']:<30} {d['value']!s:<14} {d['pts']:+6.1f}")


if __name__ == "__main__":
    main()
