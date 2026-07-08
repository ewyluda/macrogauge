"""QA self-test v0 — results are published, never block publication."""
import json
import math
from datetime import date
from pathlib import Path

STALE_DAYS = 80  # ~1 CPI cycle + release slip headroom (final-review calibration)


def run_checks(cpi: dict | None, today: str, source_results: list | None = None,
               freshness: list[dict] | None = None, gauge: dict | None = None,
               engine_error: str | None = None) -> dict:
    if cpi is not None:
        age = (date.fromisoformat(today) - date.fromisoformat(cpi["month"])).days
        checks = [
            {"name": "headline_current", "critical": True,
             "pass": age <= STALE_DAYS,
             "detail": f"latest official month {cpi['month']} is {age}d old "
                       f"(limit {STALE_DAYS})"},
            {"name": "yoy_finite", "critical": True,
             "pass": math.isfinite(cpi["yoy_pct"])
                     and math.isfinite(cpi["prev_yoy_pct"]),
             "detail": f"yoy={cpi['yoy_pct']} prev={cpi['prev_yoy_pct']}"},
        ]
    else:
        detail = (f"engine failed: {engine_error}" if engine_error
                  else "no headline computed")
        checks = [
            {"name": "headline_current", "critical": True, "pass": False,
             "detail": detail},
            {"name": "yoy_finite", "critical": True, "pass": False,
             "detail": detail},
        ]
    checks.append({"name": "engine_ok", "critical": True,
                   "pass": engine_error is None,
                   "detail": engine_error or "engine and writers completed"})
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
    if gauge is not None:
        gauge_age = (date.fromisoformat(today)
                     - date.fromisoformat(gauge["as_of"])).days
        checks.append({"name": "gauge_current", "critical": True,
                       "pass": gauge_age <= 7,
                       "detail": f"gauge as-of {gauge['as_of']} is "
                                 f"{gauge_age}d old (limit 7)"})
        missing, gated = gauge["null_components"], gauge["gate_flags"]
        checks.append({"name": "gauge_components_present", "critical": True,
                       "pass": not missing,
                       "detail": ("all components present at grid end"
                                  if not missing
                                  else f"missing — {', '.join(missing)}")
                                 + (f"; gated today — {', '.join(gated)}"
                                    if gated else "")})
        checks.append({"name": "basket_weights_sum", "critical": True,
                       "pass": abs(gauge["weights_sum"] - 1.0) <= 1e-9,
                       "detail": f"sum(weights) = {gauge['weights_sum']}"})
        checks.append({"name": "gauge_coverage", "critical": False,
                       "pass": gauge["coverage_pct"] >= 35.0,
                       "detail": f"gauge live coverage "
                                 f"{gauge['coverage_pct']}% (floor 35%)"})
        corr = gauge["tracker_corr"]
        checks.append({"name": "tracker_corr", "critical": False,
                       "pass": corr is not None and corr >= 0.95,
                       "detail": f"tracker monthly-YoY corr vs official = "
                                 f"{corr} (floor 0.95)"})
    return {"generated_at": today, "passed": sum(c["pass"] for c in checks),
            "total": len(checks), "checks": checks}


def write(result: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "qa.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    return path
