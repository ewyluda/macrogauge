"""Shared publish-writer helpers.

Every writer publishes the same envelope (mkdir -> indent=2 -> trailing
newline), and the geography/labor/metros/matrix writers all compute the same
like-month YoY off a {obs_date: value} dict — one definition each, not a
copy per file.
"""
import json
from datetime import date, timedelta
from pathlib import Path

from pipeline.dates import months_back


def yoy_pct(obs: dict, month: str) -> float | None:
    """Like-month YoY % change off a {obs_date: value} dict.

    None when the month or its 12-months-back base is absent, or the base is
    zero (a percent change off zero is meaningless, not infinite)."""
    cur, base = obs.get(month), obs.get(months_back(month, 12))
    if cur is None or not base:
        return None
    return round((cur / base - 1) * 100, 2)


def pct_change_daily(obs: dict, as_of: str, days: int) -> float | None:
    """% change vs the obs nearest `days` before as_of (exact first, ±3d).

    Daily market series collect weekdays only, so an exact lookback lands on
    an obs-less weekend for part of every week; the small window bridges
    weekends and holidays without reaching a different price regime. None
    when no base lands in the window, or the base is zero."""
    cur = obs.get(as_of)
    if cur is None:
        return None
    target = date.fromisoformat(as_of) - timedelta(days=days)
    for offset in (0, -1, 1, -2, 2, -3, 3):  # exact first, then nearest
        base = obs.get((target + timedelta(days=offset)).isoformat())
        if base is not None:
            return None if not base else round((cur / base - 1) * 100, 2)
    return None


def write_json(payload: dict, out_dir: Path, filename: str) -> Path:
    """The standard artifact envelope: ensure dir, indent=2, trailing \\n."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / filename
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path
