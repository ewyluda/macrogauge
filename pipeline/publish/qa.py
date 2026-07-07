"""QA self-test v0 — results are published, never block publication."""
import json
import math
from datetime import date
from pathlib import Path

STALE_DAYS = 80  # ~1 CPI cycle + release slip headroom (final-review calibration)


def run_checks(cpi: dict, today: str, source_results: list | None = None,
               freshness: list[dict] | None = None) -> dict:
    age = (date.fromisoformat(today) - date.fromisoformat(cpi["month"])).days
    checks = [
        {"name": "headline_current", "critical": True,
         "pass": age <= STALE_DAYS,
         "detail": f"latest official month {cpi['month']} is {age}d old (limit {STALE_DAYS})"},
        {"name": "yoy_finite", "critical": True,
         "pass": math.isfinite(cpi["yoy_pct"]) and math.isfinite(cpi["prev_yoy_pct"]),
         "detail": f"yoy={cpi['yoy_pct']} prev={cpi['prev_yoy_pct']}"},
    ]
    if source_results is not None:
        failed = [f"{r.source}: {r.error}" for r in source_results if not r.ok]
        checks.append({"name": "connectors_ok", "critical": False,
                       "pass": not failed,
                       "detail": (f"{len(source_results) - len(failed)}"
                                  f"/{len(source_results)} ok"
                                  + (f"; failed — {'; '.join(failed)}" if failed else ""))})
    if freshness is not None:
        stale = []
        for row in freshness:
            if row["latest_obs"] is None:
                stale.append(f"{row['code']} (never seen)")
                continue
            days = (date.fromisoformat(today) - date.fromisoformat(row["latest_obs"])).days
            if days > row["limit_days"]:
                stale.append(f"{row['code']} ({days}d > {row['limit_days']}d)")
        checks.append({"name": "sources_fresh", "critical": False,
                       "pass": not stale,
                       "detail": (f"{len(freshness) - len(stale)}/{len(freshness)} fresh"
                                  + (f"; stale — {', '.join(stale)}" if stale else ""))})
    return {"generated_at": today, "passed": sum(c["pass"] for c in checks),
            "total": len(checks), "checks": checks}


def write(result: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "qa.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    return path
