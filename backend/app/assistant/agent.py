"""The question → answer loop: the model searches with tools, then returns statements with quotes, which are checked."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from .grounding import ground
from .tools import DEFINITIONS, Toolbox
from .verify import check_support

MAX_TOOL_ROUNDS = 6
HISTORY_TURNS = 6

INSTRUCTIONS = """You are Esteban, the bartender: the assistant inside a tender pricing tool used by estimators at Equans (Switzerland).
You answer questions about the tender being priced, our offer for it, and the company's own data.

Rules (strict; answers are checked by a program and anything that breaks them is removed):
- Use only what the tools return in this conversation. Never use outside knowledge for facts, numbers, dates or names.
- Look before answering: search the tender (in German, with the tender's terms; e.g. Zahlungsbedingungen, Skonto,
  Zuschlagskriterien, Garantie, Termine), read whole pages when a passage is cut, and use several searches if needed.
- Every statement carries at least one citation: the source id exactly as shown in the tool result ("p9", "bid",
  "pos:<line id>", "d1") and a quote copied character for character from that source (keep its language, 5–200 chars,
  the shortest span that proves the statement). Do not translate, paraphrase or join quotes.
- One fact per statement, short and plain, in the language of the question ({language} if unclear); translate the
  meaning, never the quote.
- If the sources do not contain the answer: status "not_found" and say briefly what you looked for (no figures).
- Dates, deadlines, amounts and rates: confirm with at least two searches in different words. The written conditions
  (Bedingungen) prevail over schedules and tables; a schedule (Terminprogramm) row gives a task, its duration and
  its START date, not a deadline. If sources disagree, give both, each with its citation.
- If the question rests on a wrong premise, answer with what the sources actually say.
- Greetings or unclear questions: status "chat", a short reply or a clarifying question, without facts.

Context of the screen the estimator is on: {view}

The company's data files (query_company_data):
{files}
"""

ANSWER_FORMAT = {
    "type": "json_schema",
    "name": "answer",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["status", "message", "claims"],
        "properties": {
            "status": {"type": "string", "enum": ["answered", "not_found", "chat"]},
            "message": {"type": "string", "description": "Only for not_found or chat; empty when answered."},
            "claims": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["text", "citations"],
                    "properties": {
                        "text": {"type": "string"},
                        "citations": {
                            "type": "array",
                            "items": {"type": "object", "additionalProperties": False, "required": ["source", "quote"],
                                      "properties": {"source": {"type": "string"}, "quote": {"type": "string"}}},
                        },
                    },
                },
            },
        },
    },
}


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    searches: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)  # statements the support check removed, with its reason

    def add(self, usage) -> None:
        if usage:
            self.input_tokens += usage.input_tokens
            self.output_tokens += usage.output_tokens


def answer(client: Any, model: str, question: str, toolbox: Toolbox, *, history: list[dict] | None = None, lang: str = "en",
           view: dict | None = None, reasoning_effort: str = "low") -> tuple[dict, Usage]:
    """Run the tool loop (OpenAI Responses API), then keep only statements whose quotes are printed in the cited
    source (grounding) and that the quotes, read in context, actually support (support check)."""
    instructions = INSTRUCTIONS.format(language="German" if lang == "de" else "English",
                                       view=json.dumps(view or {}, ensure_ascii=False), files=toolbox.data.overview())
    items: list = [{"role": m["role"], "content": m["content"]} for m in (history or [])[-2 * HISTORY_TURNS:]
                   if m.get("role") in ("user", "assistant") and m.get("content")]
    items.append({"role": "user", "content": question})
    usage = Usage()
    for round_ in range(MAX_TOOL_ROUNDS + 1):
        response = client.responses.create(
            model=model, instructions=instructions, input=items, tools=DEFINITIONS,
            tool_choice="auto" if round_ < MAX_TOOL_ROUNDS else "none",
            text={"format": ANSWER_FORMAT}, reasoning={"effort": reasoning_effort},
            store=False, include=["reasoning.encrypted_content"],  # nothing kept at OpenAI; reasoning travels with the turn
        )
        usage.add(response.usage)
        calls = [o for o in response.output if o.type == "function_call"]
        if not calls:
            break
        items += response.output
        for call in calls:
            args = json.loads(call.arguments or "{}")
            if call.name == "search_tender":
                usage.searches.append(args.get("query", ""))
            items.append({"type": "function_call_output", "call_id": call.call_id, "output": toolbox.call(call.name, args)})
    try:
        raw = json.loads(response.output_text)
    except (json.JSONDecodeError, TypeError):
        raw = {"status": "not_found", "message": "", "claims": []}
    grounded = ground(raw, toolbox.sources | _cited_pages(raw, toolbox), lang)
    contexts = {c["n"]: c.pop("context") for c in grounded["citations"]}
    checked, usage.removed, check_usage = check_support(client, model, question, grounded, contexts, lang)
    usage.add(check_usage)
    return checked, usage


def _cited_pages(raw: dict, toolbox: Toolbox) -> dict:
    """Tender pages cited but not opened in this turn (e.g. remembered from an earlier answer) are still checked."""
    out = {}
    for claim in raw.get("claims", []):
        for c in claim.get("citations", []):
            source = toolbox.source_for(c.get("source", ""))
            if source:
                out[source.id] = source
    return out
