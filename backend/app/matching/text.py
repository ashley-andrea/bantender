"""Bilingual user-facing text. Every reason, check and assumption is returned in English and German."""


def T(en: str, de: str) -> dict:
    return {"en": en, "de": de}


def chf(value: float) -> str:
    return f"{value:,.2f}".replace(",", "'")
