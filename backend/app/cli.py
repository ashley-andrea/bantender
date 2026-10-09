"""Command line tools.

    python -m app.cli crosscheck <tender_id|--all>   Docling cross-check for stored tenders (needs the docling extra)
"""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from app.config import get_settings
from app.parsing.pipeline import docling_cross_check
from app.storage import make_storage


def crosscheck(tender_ids: list[str]) -> None:
    settings = get_settings()
    storage = make_storage(settings.storage, settings.data_dir)
    for tender_id in tender_ids:
        parsed = json.loads(storage.get(f"tenders/{tender_id}/parsed.json"))
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "tender.pdf"
            pdf.write_bytes(storage.get(f"tenders/{tender_id}/tender.pdf"))
            parsed = docling_cross_check(pdf, parsed, settings.docling_mode, settings.data_dir / "cache" / "docling")
        storage.put(f"tenders/{tender_id}/parsed.json", json.dumps(parsed, ensure_ascii=False).encode())
        flags = sum(1 for a in parsed["anomalies"] if a["code"] == "reader_disagreement")
        print(f"{tender_id}: cross-check done, {flags} page(s) where readers disagree, {len(parsed['meta']['figures'])} figures")


def main() -> None:
    ap = argparse.ArgumentParser(prog="app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    cc = sub.add_parser("crosscheck")
    cc.add_argument("tender_id", nargs="?")
    cc.add_argument("--all", action="store_true")
    args = ap.parse_args()
    if args.cmd == "crosscheck":
        settings = get_settings()
        root = settings.data_dir / "files" / "tenders"
        ids = sorted(p.name for p in root.iterdir() if p.is_dir()) if args.all else [args.tender_id]
        crosscheck([i for i in ids if i])


if __name__ == "__main__":
    main()
