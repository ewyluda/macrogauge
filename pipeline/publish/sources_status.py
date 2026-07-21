"""Writer for sources_status.json — per-connector health, in public."""
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from pipeline.publish.util import write_json
from pipeline.store import vintage


def build(results, sources, series, conn) -> dict:
    by_source: dict[str, list] = {}
    for s in series:
        by_source.setdefault(s.source, []).append(s)
    rows = []
    for r in sorted(results, key=lambda r: r.source):
        src = sources[r.source]
        codes = [s.code for s in by_source.get(r.source, [])]
        latest = [d for d in (vintage.max_obs_date(conn, c) for c in codes)
                  if d is not None]
        rows.append({"name": r.source, "route": src.route, "cadence": src.cadence,
                     **{k: v for k, v in asdict(r).items() if k != "source"},
                     "series_count": len(codes),
                     "latest_obs": max(latest) if latest else None})
    return {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": rows}


def write(status: dict, out_dir: Path) -> Path:
    return write_json(status, out_dir, "sources_status.json")
