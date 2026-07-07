"""QA self-test v0 — results are published, never block publication."""
import json
import math
from datetime import date
from pathlib import Path

STALE_DAYS = 75  # a monthly CPI print should never be older than this


def run_checks(cpi: dict, today: str) -> dict:
    age = (date.fromisoformat(today) - date.fromisoformat(cpi["month"])).days
    checks = [
        {"name": "headline_current", "critical": True,
         "pass": age <= STALE_DAYS,
         "detail": f"latest official month {cpi['month']} is {age}d old (limit {STALE_DAYS})"},
        {"name": "yoy_finite", "critical": True,
         "pass": math.isfinite(cpi["yoy_pct"]) and math.isfinite(cpi["prev_yoy_pct"]),
         "detail": f"yoy={cpi['yoy_pct']} prev={cpi['prev_yoy_pct']}"},
    ]
    return {"generated_at": today, "passed": sum(c["pass"] for c in checks),
            "total": len(checks), "checks": checks}


def write(result: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "qa.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    return path
