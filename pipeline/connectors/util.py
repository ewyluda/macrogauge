"""Shared connector helpers."""


def month_first(period: str) -> str:
    """'2026-05' or '2026-05-31' -> '2026-05-01' (monthly obs are first-of-month)."""
    return f"{period[:7]}-01"


def get_text(url: str, http_get) -> str:
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    return resp.text
