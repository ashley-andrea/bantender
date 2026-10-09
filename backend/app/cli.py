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
            result = docling_cross_check(pdf, parsed, settings.docling_mode, settings.data_dir / "cache" / "docling")
        # Stored separately and merged on read: never overwrites the parse.
        storage.put(f"tenders/{tender_id}/crosscheck.json", json.dumps(result, ensure_ascii=False).encode())
        msg = result["anomalies"][0]["message"] if result["anomalies"] else "readers agree"
        print(f"{tender_id}: cross-check done, {len(result['meta']['figures'])} figures. {msg}")


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
