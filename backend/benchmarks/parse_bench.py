"""Benchmark document-parsing configurations on the Oberglatt tender.

    uv run python -m benchmarks.parse_bench [--skip-docling]

Configurations
  A pymupdf            PyMuPDF rows + bold headers (deterministic)
  B pymupdf_nobold     same, without font information (ablation)
  C docling_text       Docling layout, no table model; rows from text items
  D docling_tables     Docling layout + TableFormer accurate; rows from text items
  E docling_fast       Docling layout + TableFormer fast
  F hybrid             A for LV lines + D's table structure for component lists

No OpenAI calls are made. Docling conversions are cached under data/cache/docling.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from pathlib import Path

from app.parsing import docling_layer
from app.parsing.evaluate import evaluate
from app.parsing.lv_segment import segment
from app.parsing.pdf_layer import read_rows

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "data/samples/oberglatt/BKP_244_LV_Lueftung_260804.pdf"
EXAMPLES = ROOT / "data/samples/oberglatt/example_lv_positions.csv"
CACHE = ROOT / "data/cache/docling"
OUT = Path(__file__).parent / "results"
LV_RANGE = (67, 199)

# Hand-checked from the PDF (p.76, LA01 round ducts, total length in mm per DN).
HAND_CHECK_ROUND = {100.0: 33860, 125.0: 18996, 160.0: 50419, 200.0: 7990}


def component_score(rows) -> dict:
    by_table = Counter(r.table for r in rows)
    la01 = {r.dims[0]: r.quantity for r in rows if r.page == 76 and r.table == "ducts_round" and r.dims}
    hits = sum(1 for dn, mm in HAND_CHECK_ROUND.items() if la01.get(dn) == mm)
    return {"component_rows": sum(by_table.values()), "by_table": dict(by_table), "hand_check": f"{hits}/4"}


def score(name, tender, seconds, examples, component_rows=None) -> dict:
    ev = evaluate(tender.lines, examples)
    comp = component_score(component_rows if component_rows is not None else tender.component_rows)
    return {
        "config": name, "seconds": round(seconds, 1),
        "lines": len(tender.lines),
        "lines_by_system": dict(Counter(l.system for l in tender.lines)),
        "examples_found": f"{ev['found']}/{ev['total']}",
        "examples_size_ok": f"{ev['size_ok']}/{ev['size_checked']}",
        "examples_system_ok": f"{ev['system_ok']}/{ev['total']}",
        "anomalies": dict(Counter(a.code for a in tender.anomalies)),
        **comp,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-docling", action="store_true")
    args = ap.parse_args()
    examples = list(csv.DictReader(EXAMPLES.open(encoding="utf-8")))
    results = []

    t = time.perf_counter()
    rows, _ = read_rows(PDF)
    base = segment(rows, use_bold=True)
    results.append(score("A pymupdf", base, time.perf_counter() - t, examples))

    t = time.perf_counter()
    results.append(score("B pymupdf_nobold", segment(rows, use_bold=False), time.perf_counter() - t, examples))

    if not args.skip_docling:
        page_system = {r.page: r.system for r in base.component_rows}
        # Docling only sees the LV range; pages 1–66 hold no positions. p.3 (lots) comes from PyMuPDF rows.
        for name, mode in (("C docling_text", "text"), ("D docling_tables", "tables_accurate"), ("E docling_fast", "tables_fast")):
            t = time.perf_counter()
            doc = docling_layer.convert(PDF, mode, LV_RANGE, CACHE)
            convert_s = time.perf_counter() - t
            drows = docling_layer.rows_from_doc(doc)
            drows[3] = rows[3]
            for p in range(1, LV_RANGE[0]):
                drows.setdefault(p, rows[p] if p == 3 else [])
            tender = segment(drows, use_bold=True)
            comp = docling_layer.component_rows_from_doc(doc, page_system) if mode != "text" else tender.component_rows
            res = score(name, tender, time.perf_counter() - t, examples, comp)
            res["docling_convert_seconds"] = round(convert_s, 1)
            res["figures"] = len(docling_layer.figures(doc))
            results.append(res)
            if mode == "tables_accurate":
                hybrid = score("F hybrid (A lines + D tables)", base, results[0]["seconds"] + convert_s, examples, comp)
                hybrid["figures"] = res["figures"]

        results.append(hybrid)

    OUT.mkdir(exist_ok=True)
    (OUT / "parse_bench.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    cols = ["config", "seconds", "lines", "examples_found", "examples_size_ok", "examples_system_ok", "component_rows", "hand_check"]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in results:
        lines.append("| " + " | ".join(str(r.get(c, "")) for c in cols) + " |")
    (OUT / "parse_bench.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
