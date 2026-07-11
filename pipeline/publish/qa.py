"""QA self-test v0 — results are published, never block publication."""
import json
import math
from datetime import date
from pathlib import Path

STALE_DAYS = 80  # ~1 CPI cycle + release slip headroom (final-review calibration)
FUEL_DIVERGENCE_MAX = 0.075  # AAA (daily pump) vs EIA (weekly survey) — same-day gap
                             # is expected by design; only flag if it blows out
QUILT_MONTHS_MIN = 24
GROCERY_ITEMS_MIN = 20
# Coverage floor: 40, not the 45 that a food_home live-data flip would have allowed —
# that flip was reverted in Task 6 (day-one gap failed), so food_home stays
# BLS-CF (official-only, no live blend) per the 2a deviation.
GAUGE_COVERAGE_FLOOR = 40.0


def run_checks(cpi: dict | None, today: str, source_results: list | None = None,
               freshness: list[dict] | None = None, gauge: dict | None = None,
               engine_error: str | None = None, fuel_divergence: dict | None = None,
               artifacts: dict | None = None) -> dict:
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
    if fuel_divergence is not None:
        aaa, eia = fuel_divergence.get("aaa_wk_avg"), fuel_divergence.get("eia")
        if aaa is None or eia is None:
            checks.append({"name": "fuel_sources_agree", "critical": False,
                           "pass": True,
                           "detail": "one or both fuel sources lack data — "
                                     f"aaa={aaa}, eia={eia} (check skipped)"})
        else:
            rel = fuel_divergence.get("rel", abs(aaa / eia - 1))
            n_obs = fuel_divergence.get("n_obs", "?")
            checks.append({"name": "fuel_sources_agree", "critical": False,
                           "pass": rel <= FUEL_DIVERGENCE_MAX,
                           "detail": f"AAA avg over {n_obs} obs ${aaa} vs EIA weekly ${eia} "
                                     f"— relative divergence {rel:.1%} "
                                     f"(limit {FUEL_DIVERGENCE_MAX:.1%}; some gap "
                                     f"is expected by design — different survey methods)"})
    if artifacts is not None:
        quilt_months = artifacts.get("quilt_months", 0)
        quilt_aligned = artifacts.get("quilt_aligned", True)
        checks.append({"name": "quilt_complete", "critical": False,
                       "pass": quilt_months >= QUILT_MONTHS_MIN and quilt_aligned,
                       "detail": f"quilt covers {quilt_months} months "
                                 f"(floor {QUILT_MONTHS_MIN})"
                                 + ("" if quilt_aligned else " (arrays misaligned)")})
        grocery_items, grocery_skipped = (artifacts.get("grocery_items", 0),
                                          artifacts.get("grocery_skipped", 0))
        checks.append({"name": "grocery_items", "critical": False,
                       "pass": grocery_items >= GROCERY_ITEMS_MIN,
                       "detail": f"grocery basket has {grocery_items} items, "
                                 f"{grocery_skipped} skipped "
                                 f"(floor {GROCERY_ITEMS_MIN})"})
        nowcast = artifacts.get("nowcast")
        if nowcast is not None:
            checks.append({"name": "nowcast_fresh", "critical": False,
                           "pass": nowcast["cpi"]["as_of"] == today,
                           "detail": f"CPI nowcast as-of {nowcast['cpi']['as_of']}"})
            checks.append({"name": "ensemble_computed", "critical": False,
                           "pass": nowcast["ensemble"]["value"] is not None,
                           "detail": f"ensemble={nowcast['ensemble']['value']} "
                                     f"weights={nowcast['ensemble']['weights']}"})
            params = nowcast["cpi"].get("parameters", {})
            checks.append({"name": "nowcast_params_published", "critical": True,
                           "pass": all(k in params for k in
                                       ("fuel_beta", "rent_lag_months", "rent_w")),
                           "detail": f"parameters={params}"})
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
                       "pass": gauge["coverage_pct"] >= GAUGE_COVERAGE_FLOOR,
                       "detail": f"gauge live coverage "
                                 f"{gauge['coverage_pct']}% "
                                 f"(floor 40 (food_home BLS-CF per 2a deviation))"})
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
