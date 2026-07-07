"""Writer for pulse_lite.json — Phase 0's single daily-state file."""
import json
from pathlib import Path


def write(cpi: dict, out_dir: Path, published_at: str) -> Path:
    payload = {
        "published_at": published_at,
        "official_cpi": {
            "series_code": cpi["series_code"],
            "month": cpi["month"],
            "yoy_pct": round(cpi["yoy_pct"], 2),
            "prev_yoy_pct": round(cpi["prev_yoy_pct"], 2),
            "as_of": cpi["as_of"],
        },
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "pulse_lite.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path
