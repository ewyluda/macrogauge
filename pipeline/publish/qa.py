"""QA self-test v0 — results are published, never block publication."""
import math
from collections import Counter
from datetime import date
from pathlib import Path
from pipeline import freshness as fr
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
          "labor", "commodities", "capacity", "markets", "grades", "longlead",
          "rates", "compute", "housing", "changes", "revisions", "ledger")
_PHASE_DONE = {"nowcast": "nowcast completed",
               "outlook": "12-month outlook completed",
               "composites": "composites completed",
               "datacenter": "datacenter completed",
               "geography": "geography panel completed",
               "labor": "labor panel completed",
               "commodities": "commodities grid completed",
               "capacity": "capacity tracker completed",
               "markets": "DC market panel completed",
               "grades": "escalation grading harness completed",
               "longlead": "long-lead board completed",
               "rates": "rates panel completed",
               "compute": "compute price index completed",
               "housing": "housing panel completed",
               "changes": "since-yesterday diff completed",
               "revisions": "revisions panel completed",
               "ledger": "publish ledger completed"}


def run_checks(cpi: dict | None, today: str, source_results: list | None = None,
               freshness: list[dict] | None = None, gauge: dict | None = None,
               engine_error: str | None = None, fuel_divergence: dict | None = None,
               artifacts: dict | None = None,
               phase_errors: dict[str, str | None] | None = None,
               stale_stamps: list[str] | None = None) -> dict:
    if cpi is not None:
        # Age the latest PRINT, not the latest YoY-computable month.
        # official.latest_yoy walks `month` back over a base-month hole (the
        # never-published 2025-10 print), so from the Oct-2026 print
        # (~2026-11-10) until the Nov-2026 print (~2026-12-10) `month` sits at
        # 2026-09 while the data is perfectly current -- aged from `month`,
        # this critical check would have failed by construction from
        # 2026-11-21 (day 81). `latest_month` is absent from older callers
        # (tests, replayed state); fall back to `month` for them.
        latest_month = cpi.get("latest_month") or cpi["month"]
        age = (date.fromisoformat(today) - date.fromisoformat(latest_month)).days
        hole = ("" if latest_month == cpi["month"]
                else f"; YoY month {cpi['month']} (base-month hole)")
        checks = [
            {"name": "headline_current", "critical": True,
             "pass": age <= STALE_DAYS,
             "detail": f"latest official print {latest_month} is {age}d old "
                       f"(limit {STALE_DAYS}){hole}"},
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
        # Two buckets, one classifier (pipeline/freshness.py). Series with a
        # registry `absence` policy are judged on their policy, never on the
        # plain staleness limit — so a disclosure-suppressed county or a
        # seasonal BLS price can't masquerade as (or hide) a real regression.
        stale, policy_rows, problems = [], [], []
        for row in freshness:
            absence = fr.absence_from_row(row.get("absence"))
            status = fr.classify(row["latest_obs"], row["limit_days"], absence,
                                 today)
            age = fr.age_days(row["latest_obs"], today)
            if absence is None:
                if status == fr.NEVER:
                    stale.append(f"{row['code']} (never seen)")
                elif status == fr.STALE:
                    stale.append(f"{row['code']} ({age}d > {row['limit_days']}d)")
                continue
            policy_rows.append((row["code"], absence, status, age))
            if status in fr.POLICY_FAILURES:
                problems.append(f"{row['code']} [{absence.kind}] {status}"
                                + ("" if age is None else f" at {age}d")
                                + (f" (review_by {absence.review_by})"
                                   if status == fr.POLICY_EXPIRED else "")
                                + (f" (max_absence_days {absence.max_absence_days})"
                                   if status == fr.ABSENCE_EXCEEDED else ""))
        strict_total = len(freshness) - len(policy_rows)
        checks.append({"name": "sources_fresh", "critical": False,
                       "pass": not stale,
                       "detail": (f"{strict_total - len(stale)}/{strict_total} fresh"
                                  + (f" ({len(policy_rows)} under an "
                                     f"expected-absence policy, judged "
                                     f"separately)" if policy_rows else "")
                                  + (f"; stale — {', '.join(stale)}" if stale else ""))})
        kinds = Counter(a.kind for _, a, _, _ in policy_rows)
        listing = ", ".join(
            f"{code} [{a.kind}"
            + ("" if age is None else f", {age}d")
            + (f", review_by {a.review_by}" if a.review_by else "")
            + "]"
            for code, a, status, age in policy_rows)
        checks.append({"name": "expected_absence", "critical": False,
                       "pass": not problems,
                       "detail": ((f"{len(policy_rows)} series under an "
                                   f"expected-absence policy ("
                                   + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items()))
                                   + f") — {listing}")
                                  if policy_rows else
                                  "no series under an expected-absence policy")
                                 + (f"; needs attention — {'; '.join(problems)}"
                                    if problems else "")})
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
