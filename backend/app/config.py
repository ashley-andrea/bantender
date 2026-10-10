"""All configuration comes from environment variables (12-factor), so the same image runs on our server and on Azure."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "dev"
    data_dir: Path = ROOT / "data" / "runtime"
    reference_dir: Path = ROOT / "data" / "reference" / "v2"

    # Storage: "local" (server volume) now; "azure_blob" later (Azurite on our server, Azure Blob in production).
    storage: str = "local"

    # Win-probability model: "ml" (learned from data/reference/<v>/historical_bids.csv) or "placeholder" (Equans formula).
    win_model: str = "ml"
    # Tender facts the parser does not read (client estimate, client type, bidders …): stand-in for the ingestion pipeline.
    win_context_path: Path = ROOT / "data" / "samples" / "oberglatt" / "tender_context.json"

    # AI: off by default. Budget-capped when on.
    ai_provider: str = "off"  # off | openai | azure
    openai_model: str = "gpt-4.1-mini"
    openai_budget_usd: float = 5.0

    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
