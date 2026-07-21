"""Shared publish-writer helpers.

Every writer publishes the same envelope (mkdir -> indent=2 -> trailing
newline), and the geography/labor/metros/matrix writers all compute the same
like-month YoY off a {obs_date: value} dict — one definition each, not a
copy per file.
"""
import json
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


def write_json(payload: dict, out_dir: Path, filename: str) -> Path:
    """The standard artifact envelope: ensure dir, indent=2, trailing \\n."""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / filename
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path
