"""Live check of the assistant on the Oberglatt tender (calls OpenAI; needs AI_PROVIDER=openai and OPENAI_API_KEY).

Three kinds of questions:
- answerable: the answer must cite the page (or data source) where the fact is printed, and contain the fact;
- not in the tender: the assistant must say so instead of inventing an answer;
- wrong premise: the assistant must answer with what the tender says, not agree.

Also counted: statements the model wrote that grounding removed (quotes not found in the cited source).

    cd backend && uv run python -m benchmarks.assistant_eval [--only 3]
"""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastapi.testclient import TestClient

import app.api.main as main

ROOT = Path(__file__).resolve().parents[2]
TENDER = ROOT / "data" / "samples" / "oberglatt" / "BKP_244_LV_Lueftung_260804.pdf"
OUT = Path(__file__).parent / "results" / "assistant"


@dataclass
class Case:
    question: str
    kind: str  # answerable | absent | premise
    pages: set[int] = field(default_factory=set)  # one of these pages must be cited
    sources: set[str] = field(default_factory=set)  # or one of these source kinds (bid, data, position)
    expect: list[str] = field(default_factory=list)  # each must appear in the statements or quotes (case-insensitive)
    forbid: str | None = None  # regex that must not appear in the statements
    lang: str = "en"


CASES = [
    Case("When is the deadline to submit the offer?", "answerable", {9}, expect=["22"]),
    Case("What are the payment terms?", "answerable", {9, 14, 20}, expect=["45"]),
    Case("How much weight does the price have in the award, and how are price points calculated?", "answerable", {9}, expect=["60", "150"]),
    Case("Are contractor variants allowed?", "answerable", {8, 21}, expect=["nicht zugelassen"]),
    Case("How long is the warranty period?", "answerable", {13}, expect=["2 Jahren"]),
    Case("What VAT rate and general deductions does the offer form use?", "answerable", {2}, expect=["8.1", "1.3"]),
    Case("Is there price escalation (Teuerung) or are prices fixed?", "answerable", {9, 17, 21}, expect=["Festpreise"]),
    Case("Wer ist die Bauherrschaft?", "answerable", {1, 8}, expect=["Gemeinde Oberglatt"], lang="de"),
    Case("Can we use the builder's crane?", "answerable", {20}, expect=["Kran"]),
    Case("What is our current offer price?", "answerable", sources={"bid"}, expect=["CHF"]),
    Case("What is our historical win rate on ventilation (BKP 244) bids for schools?", "answerable", sources={"data"}, expect=["school"]),
    Case("What net cost does our catalogue list for the fire damper P-FIR-001?", "answerable", sources={"data", "position"}, expect=["1487"]),
    Case("How many base hours per unit does our productivity data assume for installing a fire damper?", "answerable", sources={"data"}, expect=["3.2"]),
    Case("What is the amount of the contractual penalty (Konventionalstrafe) per day of delay?", "absent", forbid=r"(CHF|Fr\.)\s?[\d'’.,]+\s*(pro|per|/)\s*(Tag|day)"),
    Case("Which competitors are bidding on this tender?", "absent"),
    Case("What is the name of Equans' CEO?", "absent"),
    Case("The payment term is 30 days, right?", "premise", {9, 14, 20}, expect=["45"], forbid=r"\b30 days\b(?! is not)"),
    Case("Since contractor variants are allowed, can we propose another air handling unit as a variant?", "premise", {8, 21},
         expect=["nicht zugelassen"]),
]


def norm(s: str) -> str:
    return re.sub(r"[\s'’,]", "", s.lower())


def check(case: Case, r: dict) -> list[str]:
    problems = []
    statements = " ".join(s["text"] for s in r["statements"])
    quotes = " ".join(c["quote"] for c in r["citations"])
    if case.kind == "absent":
        if r["status"] == "answered" and case.forbid is None:
            problems.append("answered a question the sources cannot answer")
    else:
        if r["status"] != "answered":
            problems.append(f"status {r['status']}")
        cited_pages = {c["page"] for c in r["citations"] if c["kind"] == "tender"}
        cited_kinds = {c["kind"] for c in r["citations"]}
        if (case.pages or case.sources) and not (cited_pages & case.pages or cited_kinds & case.sources):
            problems.append(f"cites {sorted(cited_pages)} {sorted(cited_kinds)}, expected pages {sorted(case.pages)} or {sorted(case.sources)}")
        for e in case.expect:
            if norm(e) not in norm(statements + " " + quotes):
                problems.append(f"missing {e!r}")
    if case.forbid and re.search(case.forbid, statements + " " + r.get("message", ""), re.I):
        problems.append(f"says {case.forbid!r}")
    return problems


def main_(only: int | None) -> None:
    if not main.assistant.enabled:
        raise SystemExit("Set AI_PROVIDER=openai and OPENAI_API_KEY in .env first.")
    client = TestClient(main.app)
    tender_id = client.post("/api/tenders", files={"file": (TENDER.name, TENDER.read_bytes(), "application/pdf")}).json()["tender_id"]
    started_spend = main.assistant.spent()
    t = time.perf_counter()
    main.assistant.index(tender_id)
    print(f"index ready in {time.perf_counter() - t:.1f} s ({main.assistant.embed.model if main.assistant.embed else 'BM25 only'})\n")

    results = []
    for i, case in enumerate(CASES[:only] if only else CASES, 1):
        t = time.perf_counter()
        res = client.post(f"/api/tenders/{tender_id}/assistant", json={"question": case.question, "lang": case.lang})
        seconds = time.perf_counter() - t
        if res.status_code != 200:
            print(f"{i:2}. ERROR {res.status_code} {res.text}")
            results.append({"case": case.question, "error": res.text})
            continue
        r = res.json()
        problems = check(case, r)
        results.append({"case": case.question, "kind": case.kind, "ok": not problems, "problems": problems, "seconds": round(seconds, 1), **r})
        print(f"{i:2}. {'PASS' if not problems else 'FAIL'}  [{case.kind}] {case.question}  ({seconds:.0f} s, {r['status']}, "
              f"searches: {r['searches']}, removed by grounding: {r['unverified']})")
        for s in r["statements"]:
            print(f"      - {s['text']} {s['refs']}")
        if r["message"]:
            print(f"      » {r['message']}")
        for c in r["citations"]:
            print(f"      [{c['n']}] {c['label']}: “{c['quote']}”")
        for p in problems:
            print(f"      ! {p}")

    ok = sum(r.get("ok", False) for r in results)
    removed = sum(r.get("unverified", 0) for r in results)
    kept = sum(len(r.get("statements", [])) for r in results)
    print(f"\n{ok}/{len(results)} passed · {kept} statements shown, all with a verified quote · {removed} removed by grounding"
          f" · spent USD {main.assistant.spent() - started_spend:.3f}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "latest.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", type=int, help="run the first N questions")
    main_(parser.parse_args().only)
