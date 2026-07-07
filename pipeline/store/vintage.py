"""Append-only vintage observation store: JSONL partitioned by vintage month.

Re-published values append a new vintage row — never overwrite. History
can't be silently rewritten; git is the audit trail.
"""
import json
from dataclasses import asdict
from pathlib import Path

from pipeline.models import Observation

OBS_SUBDIR = "obs"


def _partitions(store_dir: Path) -> list[Path]:
    d = store_dir / OBS_SUBDIR
    return sorted(d.glob("*.jsonl")) if d.exists() else []


def _latest_values(store_dir: Path) -> dict[tuple[str, str], float]:
    """Latest stored value per (series_code, obs_date), by vintage then file order."""
    latest: dict[tuple[str, str], float] = {}
    latest_vintage: dict[tuple[str, str], str] = {}
    for part in _partitions(store_dir):
        for line in part.read_text().splitlines():
            row = json.loads(line)
            key = (row["series_code"], row["obs_date"])
            if key not in latest_vintage or row["vintage_date"] >= latest_vintage[key]:
                latest_vintage[key] = row["vintage_date"]
                latest[key] = row["value"]
    return latest


def append(observations: list[Observation], store_dir: Path) -> int:
    """Append observations whose value differs from the latest stored one."""
    latest = _latest_values(store_dir)
    written = 0
    for o in observations:
        if latest.get((o.series_code, o.obs_date)) == o.value:
            continue
        part = store_dir / OBS_SUBDIR / f"{o.vintage_date[:7]}.jsonl"
        part.parent.mkdir(parents=True, exist_ok=True)
        with part.open("a") as f:
            f.write(json.dumps(asdict(o), sort_keys=True) + "\n")
        latest[(o.series_code, o.obs_date)] = o.value
        written += 1
    return written
