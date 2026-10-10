"""The assistant per deployment: OpenAI client, one search index per tender (built once, stored), and the budget cap."""

from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable

from app.storage import Storage

from .agent import answer
from .company_data import CompanyData
from .index import INDEX_VERSION, TenderIndex
from .tools import Toolbox

SPEND_KEY = "assistant/spend.json"


class BudgetExceeded(Exception):
    pass


class OpenAIEmbed:
    def __init__(self, client: Any, model: str, on_tokens: Callable[[int], None]):
        self.client, self.model, self.on_tokens = client, model, on_tokens

    def __call__(self, texts: list[str]) -> list[list[float]]:
        out = []
        for i in range(0, len(texts), 256):
            r = self.client.embeddings.create(model=self.model, input=texts[i:i + 256])
            self.on_tokens(r.usage.total_tokens)
            out += [d.embedding for d in r.data]
        return out


class AssistantService:
    def __init__(self, storage: Storage, reference_dir: Path, *, client: Any | None, model: str, embedding_model: str | None,
                 reasoning_effort: str, budget_usd: float, prices_per_mtok: dict[str, float]):
        self.storage = storage
        self.data = CompanyData(reference_dir)
        self.client = client
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.budget_usd = budget_usd
        self.prices = prices_per_mtok  # input, output, embedding: USD per million tokens
        self.embed = OpenAIEmbed(client, embedding_model, self._spend_embedding) if client and embedding_model else None
        self._indexes: dict[str, TenderIndex] = {}
        self._lock = threading.Lock()
        self._spend_lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.client is not None

    def status(self) -> dict:
        return {"enabled": self.enabled, "model": self.model if self.enabled else None,
                "spent_usd": round(self.spent(), 4), "budget_usd": self.budget_usd}

    # ---- index per tender ---------------------------------------------------------------------

    def index(self, tender_id: str) -> TenderIndex:
        with self._lock:
            if tender_id in self._indexes:
                return self._indexes[tender_id]
            key = f"tenders/{tender_id}/assistant_index.json"
            want = self.embed.model if self.embed else None
            stored = json.loads(self.storage.get(key)) if self.storage.exists(key) else None
            if stored and stored["version"] == INDEX_VERSION and stored.get("embedding_model") == want:
                index = TenderIndex.from_dict(stored)
            else:
                self._check_budget()
                with tempfile.TemporaryDirectory() as tmp:
                    pdf = Path(tmp) / "tender.pdf"
                    pdf.write_bytes(self.storage.get(f"tenders/{tender_id}/tender.pdf"))
                    index = TenderIndex.build(pdf, self.embed)
                self.storage.put(key, json.dumps(index.to_dict()).encode())
            self._indexes[tender_id] = index
            return index

    # ---- ask ----------------------------------------------------------------------------------

    def ask(self, tender_id: str, question: str, pricing: Callable[[], dict], *, history: list[dict] | None = None,
            lang: str = "en", view: dict | None = None, offer: Callable[[dict], dict] | None = None) -> dict:
        if not self.enabled:
            raise RuntimeError("The assistant is off (set AI_PROVIDER=openai and OPENAI_API_KEY).")
        self._check_budget()
        toolbox = Toolbox(self.index(tender_id), pricing, self.data, self.embed, offer=offer)
        result, usage = answer(self.client, self.model, question, toolbox, history=history, lang=lang, view=view,
                               reasoning_effort=self.reasoning_effort)
        self._add_spend(usage.input_tokens * self.prices["input"] / 1e6 + usage.output_tokens * self.prices["output"] / 1e6)
        return {**result, "searches": usage.searches, "removed": usage.removed}

    # ---- budget -------------------------------------------------------------------------------

    def spent(self) -> float:
        return json.loads(self.storage.get(SPEND_KEY))["usd"] if self.storage.exists(SPEND_KEY) else 0.0

    def _add_spend(self, usd: float) -> None:
        with self._spend_lock:
            self.storage.put(SPEND_KEY, json.dumps({"usd": self.spent() + usd}).encode())

    def _spend_embedding(self, tokens: int) -> None:
        self._add_spend(tokens * self.prices["embedding"] / 1e6)

    def _check_budget(self) -> None:
        if self.spent() >= self.budget_usd:
            raise BudgetExceeded(f"The AI budget of USD {self.budget_usd:g} for this deployment is used up.")


def make_assistant(settings, storage: Storage) -> AssistantService:
    client = None
    if settings.ai_provider == "openai" and settings.openai_api_key:
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key, timeout=90)
    return AssistantService(
        storage, settings.reference_dir, client=client, model=settings.openai_model, embedding_model=settings.openai_embedding_model,
        reasoning_effort=settings.openai_reasoning_effort, budget_usd=settings.openai_budget_usd,
        prices_per_mtok={"input": settings.openai_price_input, "output": settings.openai_price_output,
                         "embedding": settings.openai_price_embedding},
    )
