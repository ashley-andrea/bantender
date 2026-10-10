"""Second check: does each statement actually follow from its quotes, read in context?

Grounding proves the quotes are printed in the sources. It cannot tell a quote that proves the statement from one
that is misread (a start date in a schedule taken for a deadline, a list price taken for a net price). A separate
model call, which sees only the statements and the passages around their quotes, removes those statements.
"""

from __future__ import annotations

import json
from typing import Any

from .grounding import NO_PROOF

INSTRUCTIONS = """You audit statements written by an assistant against the source passages they cite.
For each statement decide whether the cited passages state it. Mark it unsupported if it:
- misreads the passage (e.g. a task's start date in a schedule read as a deadline, a duration read as a date,
  a value from another row or column, a list price read as a net price);
- adds facts, numbers or conclusions the passages do not contain;
- generalises a passage about something else.
Translation and plain rewording are fine. Judge each statement only by its own passages."""

FORMAT = {
    "type": "json_schema",
    "name": "verdicts",
    "strict": True,
    "schema": {
        "type": "object", "additionalProperties": False, "required": ["verdicts"],
        "properties": {"verdicts": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["statement", "supported", "reason"],
            "properties": {"statement": {"type": "integer"}, "supported": {"type": "boolean"}, "reason": {"type": "string"}}}}},
    },
}


def check_support(client: Any, model: str, question: str, grounded: dict, contexts: dict[int, str], lang: str) -> tuple[dict, list[str], Any]:
    """Remove statements the auditor finds unsupported. Returns (answer, reasons for removals, usage)."""
    if grounded["status"] != "answered":
        return grounded, [], None
    blocks = []
    for i, s in enumerate(grounded["statements"], 1):
        passages = "\n".join(f"  [{n}] quote: “{grounded['citations'][n - 1]['quote']}”\n      in context: {contexts[n]}" for n in s["refs"])
        blocks.append(f"Statement {i}: {s['text']}\n{passages}")
    response = client.responses.create(
        model=model, instructions=INSTRUCTIONS, input=f"Question: {question}\n\n" + "\n\n".join(blocks),
        text={"format": FORMAT}, reasoning={"effort": "low"}, store=False,
    )
    try:
        verdicts = {v["statement"]: v for v in json.loads(response.output_text)["verdicts"]}
    except (json.JSONDecodeError, KeyError, TypeError):
        verdicts = {}
    # A statement the auditor did not return a verdict for is not shown: no check, no claim.
    keep = [s for i, s in enumerate(grounded["statements"], 1) if verdicts.get(i, {}).get("supported")]
    removed = [f"{s['text']} — {verdicts.get(i, {}).get('reason', 'not checked')}"
               for i, s in enumerate(grounded["statements"], 1) if not verdicts.get(i, {}).get("supported")]
    return renumber(grounded, keep, len(removed), lang), removed, response.usage


def renumber(grounded: dict, statements: list[dict], removed: int, lang: str) -> dict:
    """Keep only the citations the remaining statements use, numbered 1… in order of first use."""
    old = {c["n"]: c for c in grounded["citations"]}
    new_n: dict[int, int] = {}
    for s in statements:
        for n in s["refs"]:
            new_n.setdefault(n, len(new_n) + 1)
    out = {**grounded, "statements": [{**s, "refs": [new_n[n] for n in s["refs"]]} for s in statements],
           "citations": [{**old[n], "n": m} for n, m in new_n.items()], "unverified": grounded["unverified"] + removed}
    if not statements:
        out.update(status="not_found", message=NO_PROOF[lang], citations=[])
    return out
