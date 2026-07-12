"""Shared connector helpers."""
from pipeline.dates import month_first  # noqa: F401 — re-export; connectors import from here


def get_text(url: str, http_get) -> str:
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    return resp.text
