"""QA self-test v0 — results are published, never block publication."""
import math
from datetime import date
from pathlib import Path
from pipeline.publish.util import write_json

STALE_DAYS = 80  # ~1 CPI cycle + release slip headroom (final-review calibration)
FUEL_DIVERGENCE_MAX = 0.075  # AAA (daily pump) vs EIA (weekly survey) — same-day gap
                             # is expected by design; only flag if it blows out
QUILT_MONTHS_MIN = 24
GROCERY_ITEMS_MIN = 20
# Coverage floor: 40, not the 45 that a food_home live-data flip would have allowed —
# that flip was reverted in Task 6 (day-one gap failed), so food_home stays
# BLS-CF (official-only, no live blend) per the 2a deviation.
GAUGE_COVERAGE_FLOOR = 40.0

# Every isolated publish phase in run_daily.py except the core engine (which
# has its own cpi-fallback handling above). run_checks cross-checks the
# reported phase_errors dict against this tuple in BOTH directions, so a
# phase that is wired but never reported — or reported but never pinned
# here — fails its check instead of silently reading "completed".
PHASES = ("nowcast", "outlook", "composites", "datacenter", "geography",
          "labor", "commodities", "capacity")
_PHASE_DONE = {"nowcast": "nowcast completed",
               "outlook": "12-month outlook completed",
               "composites": "composites completed",
               "datacenter": "datacenter completed",
               "geography": "geography panel completed",
               "labor": "labor panel completed",
               "commodities": "commodities grid completed",
               "capacity": "capacity tracker completed"}


def run_checks(cpi: dict | None, today: str, source_results: list | None = None,
               freshness: list[dict] | None = None, gauge: dict | None = None,
               engine_error: str | None = None, fuel_divergence: dict | None = None,
               artifacts: dict | None = None,
               phase_errors: dict[str, str | None] | None = None,
               stale_stamps: list[str] | None = None) -> dict:
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
    # These checks mirror engine_ok for the isolated publish phases in
    # run_daily.py. Their failures surface distinctly and never suppress the
    # core gauge's critical checks below.
    if phase_errors is not None:
        for phase in PHASES:
            if phase not in phase_errors:
                checks.append({"name": f"{phase}_ok", "critical": False,
                               "pass": False,
                               "detail": f"{phase} phase never reported an "
                                         f"outcome — run_daily wiring gap"})
            else:
                err = phase_errors[phase]
                checks.append({"name": f"{phase}_ok", "critical": False,
                               "pass": err is None,
                               "detail": err or _PHASE_DONE[phase]})
        for phase in phase_errors:
            if phase not in PHASES:
                checks.append({"name": f"{phase}_ok", "critical": False,
                               "pass": False,
                               "detail": f"unknown phase '{phase}' — add it "
                                         f"to qa.PHASES"})
    if stale_stamps is not None:
        # Files in the out dir whose published_at differs from this run's —
        # leftovers from a prior partial/manual run about to deploy alongside
        # today's artifacts. The isolation blocks make a partially-failed run
        # legal, so this is how a mixed artifact set stays visible.
        checks.append({"name": "single_run_stamp", "critical": False,
                       "pass": not stale_stamps,
                       "detail": ("all artifacts share this run's published_at"
                                  if not stale_stamps else
                                  "stale published_at — " + ", ".join(stale_stamps))})
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
    return write_json(result, out_dir, "qa.json")
