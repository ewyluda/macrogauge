"""Deterministic CPI, PCE, NFP and ensemble nowcasts.

The functions are deliberately dependency-free and expose every fitted or
hand-seeded parameter in their results. Missing benchmark inputs are omitted,
never imputed.
"""
from __future__ import annotations

import json
import math
from datetime import date, timedelta

from pipeline.dates import month_first, monthly_changes, next_month, prior_month
from pipeline.engine import signals
from pipeline.engine.outlook import DEFAULT_CONFIG
from pipeline.store import vintage


def _month_avg_change(series: dict[str, float], prior: str, target: str,
                      end: str) -> float | None:
    """Partial target-month mean (days through `end`) over the full
    prior-month mean, in percent — the CPI's own month-average collection
    convention. None when either month has no days on the grid."""
    prior_days = [v for d, v in series.items() if prior <= d < target]
    target_days = [v for d, v in series.items() if target <= d <= end]
    if not prior_days or not target_days:
        return None
    base = sum(prior_days) / len(prior_days)
    if base == 0:
        return None
    return (sum(target_days) / len(target_days) / base - 1) * 100


def _driver_slice(code: str, conn, config: dict, through_month: str,
                  staleness: dict[str, int] | None, today: str | None) -> float | None:
    """One month of the outlook's futures shock for the two components whose
    pass-through starts immediately. nat_gas/electricity are deliberately
    absent (outlook start_month 2 -- retail utility pass-through lags); wage
    anchor and goods-pipeline tilt are 12-month ramps, negligible at month 1."""
    if conn is None:
        return None
    if code == "food_home" and "food_home" in config:
        cfg = config["food_home"]
        value, used, _ = signals.equal_signal(conn, cfg["series"], through_month,
                                              cfg["lookback_months"], staleness, today)
    elif code == "used_vehicles" and "used_vehicles" in config:
        cfg = config["used_vehicles"]
        rows = vintage.latest(conn, cfg["series"])
        if not signals.fresh_series(rows, cfg["series"], staleness, today):
            return None
        value, _ = signals.lookback_return(rows, through_month, cfg["lookback_months"])
    else:
        return None
    if value is None:
        return None
    return signals.distributed_return(value * cfg["pass_through"], cfg["horizon_months"])


OFFICIAL_ONLY = ("shelter_owned", "shelter_rent")


FOOD_ENERGY = ("food_home", "food_away", "fuel", "electricity", "nat_gas")


def seasonal_mom(nsa_mom: float, conn, target: str,
                 sa_code: str = "CPIAUCSL", nsa_code: str = "CPIAUCNS") -> float | None:
    """Convert a not-seasonally-adjusted MoM to the seasonally adjusted basis
    every benchmark quotes (Cleveland Fed, Kalshi settle on SA CPI-U), using
    last year's BLS seasonal factors (SA/NSA) for the target and prior month:

        SA_mom = (1 + NSA_mom) * f(target-12) / f(prior-12) - 1

    Seasonal factors move little year to year (BLS re-estimates each
    February). None when CPIAUCSL/CPIAUCNS lack either month."""
    if conn is None:
        return None
    sa = dict(vintage.latest(conn, sa_code))
    nsa = dict(vintage.latest(conn, nsa_code))
    t12 = month_first(f"{int(target[:4]) - 1}-{target[5:7]}")
    p12 = prior_month(t12)
    try:
        f_t, f_p = sa[t12] / nsa[t12], sa[p12] / nsa[p12]
    except (KeyError, ZeroDivisionError):
        return None
    return ((1 + nsa_mom / 100) * f_t / f_p - 1) * 100


def cpi_nowcast(gauge_result: dict, target_month: str, conn=None,
                config: dict | None = None,
                staleness: dict[str, int] | None = None,
                today: str | None = None) -> dict:
    """Bottom-up CPI forecast: measured month-average moves where the target
    month has real data; capped trailing-median trend (+ one-month driver
    slice, Task 3) where it does not. Modeled rows are labeled -- a modeled
    MoM is never presented as an observed one."""
    config = config or json.loads(DEFAULT_CONFIG.read_text())
    target = month_first(target_month)
    prior = prior_month(target)
    after = next_month(target)
    variant = gauge_result["variants"]["gauge"]
    neutral = signals.monthly_from_annual(float(config["baseline_annual_pct"]))
    cap = float(config["component_trend_annual_cap_pct"])
    lo, hi = signals.monthly_from_annual(-cap), signals.monthly_from_annual(cap)
    contributions, total = [], 0.0
    tracker = gauge_result["variants"].get("tracker", {}).get("components", {})
    for code, component in variant["components"].items():
        if code in OFFICIAL_ONLY and code in tracker:
            # Market asking rents (ZORI/Apartment List) lead CPI shelter by
            # ~a year; they are not a same-month measurement of OER/rent. The
            # Aug-2026 call "measured" shelter at +0.02% from asking rents
            # while OER printed +0.26% — -0.08pp of a -0.09pp miss. Shelter
            # rows ride the official series' own trend instead.
            component = tracker[code]
        series = component["daily_index"]
        driver_mom = None
        if component["last_obs"] >= target:
            # Measured: never read past the target month -- once it is over,
            # later moves belong to the NEXT print, and this forecast gets
            # graded against a one-month actual. Month-average ratio, not
            # point-to-point: an endpoint anchored at the first of the prior
            # month spans up to two months of movement on the dense daily
            # grid (the 2026-07 gasoline row published -10.17% for what was
            # a +0.94% June-end-to-date move).
            end = min(variant["as_of"],
                      max((d for d in series if d < after), default=max(series)))
            move = _month_avg_change(series, prior, target, end) or 0.0
            basis = "measured"
        else:
            # Modeled: the component's grid is pure forward-fill inside the
            # target month; its own capped trailing-median trend replaces the
            # fabricated 0.0 (same base-rate rule as the outlook).
            levels = signals.component_trend_levels(component, prior[:7])
            move = min(hi, max(lo, signals.median_mom(
                levels, int(config["trailing_median_months"]), fallback=neutral)))
            driver_mom = _driver_slice(code, conn, config, target[:7], staleness, today)
            basis = "trend"
            if driver_mom is not None:
                move += driver_mom
                basis = "trend+driver"
        # MoM weights = relative importance price-updated to the month before
        # the target (the engine's mom_weights); YoY-base weights otherwise.
        weight = (gauge_result.get("mom_weights") or {}).get(code, component["weight"])
        contribution = weight * move
        row = {"component": code, "mom_pct": round(move, 4),
               "weight": round(weight, 6),
               "contribution_pp": round(contribution, 4), "basis": basis}
        if driver_mom is not None:
            row["driver_mom_pct"] = round(driver_mom, 4)
        contributions.append(row)
        total += contribution
    latest_yoy = variant["yoy"][variant["as_of"]]
    sa = seasonal_mom(total, conn, target)
    # Core = the same bottom-up rows ex food & energy, renormalized (the
    # residual "other" still holds alcohol and non-gasoline motor fuel, <1%
    # of CPI — an honest approximation of CPI-U less food and energy).
    core_rows = [r for r in contributions if r["component"] not in FOOD_ENERGY]
    core_w = sum(r["weight"] for r in core_rows)
    core = None
    if core_w > 0:
        core_nsa = sum(r["contribution_pp"] for r in core_rows) / core_w
        core_sa = seasonal_mom(core_nsa, conn, target, "CPILFESL", "CPILFENS")
        core = {"mom_pct": round(core_sa if core_sa is not None else core_nsa, 2),
                "mom_nsa_pct": round(core_nsa, 2),
                "basis": "SA" if core_sa is not None else "NSA",
                "weight_share": round(core_w, 4)}
    return {"target_month": target[:7],
            # Headline is SA whenever factors exist, so the model, Cleveland
            # and Kalshi are averaged and graded on one basis.
            "mom_pct": round(sa if sa is not None else total, 2),
            "mom_nsa_pct": round(total, 2),
            "basis": "SA" if sa is not None else "NSA",
            "core": core,
            "yoy_pct": round(latest_yoy, 2), "as_of": variant["as_of"],
            "status": "live", "parameters": {},
            "components": contributions}


def _ols(xs: list[list[float]], ys: list[float]) -> list[float] | None:
    """Small Gaussian-elimination OLS, with intercept already in X."""
    if not xs or len(xs) < len(xs[0]):
        return None
    n = len(xs[0])
    a = [[sum(row[i] * row[j] for row in xs) for j in range(n)]
         + [sum(row[i] * y for row, y in zip(xs, ys))] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            return None
        a[col], a[pivot] = a[pivot], a[col]
        scale = a[col][col]
        a[col] = [v / scale for v in a[col]]
        for row in range(n):
            if row == col:
                continue
            factor = a[row][col]
            a[row] = [v - factor * w for v, w in zip(a[row], a[col])]
    return [a[i][-1] for i in range(n)]


def pce_bridge(cpi_mom: float, cpi_rows, pce_rows, window: int = 24) -> dict:
    cpi, pce = monthly_changes(dict(cpi_rows)), monthly_changes(dict(pce_rows))
    months = sorted(set(cpi) & set(pce))[-window:]
    beta = _ols([[1.0, cpi[m]] for m in months], [pce[m] for m in months])
    if beta is None:
        beta = [0.0, 1.0]
    forecast = beta[0] + beta[1] * cpi_mom
    return {"mom_pct": round(forecast, 2), "parameters": {
        "intercept": round(beta[0], 6), "cpi_beta": round(beta[1], 6),
        "window_months": window, "observations": len(months)}}


# BEA prices several PCE services straight off PPIs (NIPA handbook ch. 5):
# airfares, physician and hospital care (PCE counts the employer/government
# payment CPI excludes), portfolio management. Their month-t prints land the
# day after CPI, so once CPI for t is out they are extra regressors on the
# bridge. Registry codes -> FRED ids live in config/series.json.
PPI_BRIDGE = ("ppi_pce_airline", "ppi_pce_physician", "ppi_pce_hospital",
              "ppi_pce_portfolio")
PPI_WINDOW = 60      # 6 parameters: a 24-month window leaves 18 dof — too few
PPI_MIN_OBS = 36     # below this the PPI bridge is not fit at all
OOS_MONTHS = 24      # walk-forward window that decides PPI vs CPI-only


def _bridge_fit(target: dict[str, float], regressors: list[dict[str, float]],
                months: list[str], window: int) -> list[float] | None:
    hist = months[-window:]
    return _ols([[1.0] + [r[m] for r in regressors] for m in hist],
                [target[m] for m in hist])


def _walk_forward_mae(target, regressors, months, window, min_obs) -> float | None:
    """Mean |error| of one-step-ahead fits over the last OOS_MONTHS months,
    each fit only on months before the one it predicts (with that month's
    actual regressors — the regime the PPI bridge runs in)."""
    errs = []
    for i in range(max(0, len(months) - OOS_MONTHS), len(months)):
        if i < min_obs:
            continue
        beta = _bridge_fit(target, regressors, months[:i], window)
        if beta is None:
            continue
        m = months[i]
        fit = beta[0] + sum(b * r[m] for b, r in zip(beta[1:], regressors))
        errs.append(abs(fit - target[m]))
    return sum(errs) / len(errs) if errs else None


def pce_ppi_bridge(cpi_mom: float, target_month: str, cpi_rows, pce_rows,
                   ppi_rows: dict[str, list] | None = None,
                   window: int = 24) -> dict:
    """PCE MoM from SA CPI MoM, plus the BEA-input PPIs when they are usable.

    The PPI bridge (OLS of PCE MoM on [1, CPI MoM, PPI_1..k MoM] over
    PPI_WINDOW months) is used only when every PPI has printed target_month,
    the overlap reaches PPI_MIN_OBS, and its walk-forward MAE over the last
    OOS_MONTHS beats the CPI-only bridge's — otherwise the CPI-only bridge
    (pce_bridge, unchanged) publishes, with the reason. Every coefficient and
    both out-of-sample MAEs are in `parameters`. Inputs are latest-vintage
    history (revisions included); the PPIs are NSA, as BEA uses them."""
    base = pce_bridge(cpi_mom, cpi_rows, pce_rows, window)
    base["bridge"] = "cpi"
    cpi, pce = monthly_changes(dict(cpi_rows)), monthly_changes(dict(pce_rows))
    ppi = {code: monthly_changes(dict(rows)) for code, rows in (ppi_rows or {}).items()}
    if not ppi or set(ppi) != set(PPI_BRIDGE):
        base["bridge_note"] = "PPI inputs not in the store"
        return base
    target = month_first(target_month)
    missing = [code for code in PPI_BRIDGE if target not in ppi[code]]
    if missing:
        base["bridge_note"] = (f"PPI for {target_month} not printed yet "
                               f"({', '.join(missing)})")
        return base
    months = sorted(m for m in set(cpi) & set(pce) if m < target
                    and all(m in ppi[c] for c in PPI_BRIDGE))
    if len(months) < PPI_MIN_OBS:
        base["bridge_note"] = (f"PPI overlap {len(months)} months "
                               f"< {PPI_MIN_OBS} required")
        return base
    regs_ppi = [cpi] + [ppi[c] for c in PPI_BRIDGE]
    beta = _bridge_fit(pce, regs_ppi, months, PPI_WINDOW)
    oos_ppi = _walk_forward_mae(pce, regs_ppi, months, PPI_WINDOW, PPI_MIN_OBS)
    oos_cpi = _walk_forward_mae(pce, [cpi], months, window, 2)
    base["parameters"].update({
        "oos_mae_cpi_only_pp": None if oos_cpi is None else round(oos_cpi, 4),
        "oos_mae_cpi_ppi_pp": None if oos_ppi is None else round(oos_ppi, 4),
        "oos_months": OOS_MONTHS})
    if beta is None or oos_ppi is None or oos_cpi is None or oos_ppi >= oos_cpi:
        base["bridge_note"] = ("PPI bridge did not beat the CPI-only bridge "
                               "out of sample")
        return base
    inputs = {c: round(ppi[c][target], 4) for c in PPI_BRIDGE}
    forecast = beta[0] + beta[1] * cpi_mom + sum(
        b * ppi[c][target] for b, c in zip(beta[2:], PPI_BRIDGE))
    return {"mom_pct": round(forecast, 2), "bridge": "cpi+ppi",
            "parameters": {**base["parameters"],
                           "intercept": round(beta[0], 6), "cpi_beta": round(beta[1], 6),
                           "ppi_betas": {c: round(b, 6) for c, b in zip(PPI_BRIDGE, beta[2:])},
                           "ppi_inputs_mom_pct": inputs,
                           "window_months": PPI_WINDOW,
                           "observations": len(months[-PPI_WINDOW:])}}


def _actual_mom(conn, code: str, month: str) -> float | None:
    """Published MoM for `month` (latest vintage), None until it prints."""
    if conn is None:
        return None
    levels = dict(vintage.latest(conn, code))
    return monthly_changes({m: levels[m] for m in (prior_month(month), month)
                            if m in levels}).get(month)


def pce_nowcast(conn, cpi: dict, reference_month: str, release_date: str | None,
                cpi_target_month: str | None) -> dict:
    """Headline + core PCE MoM for the next PCE release's reference month.

    CPI input: the ACTUAL seasonally adjusted CPI MoM (CPIAUCSL / CPILFESL,
    as known today) once that month's CPI is out — the usual state for the
    ~2 weeks between the CPI and PCE prints; otherwise the SA CPI nowcast,
    which then targets the same month. Neither available (a month whose CPI
    was skipped, e.g. 2025-10) → unavailable, never a guess off another
    month's nowcast."""
    month = month_first(reference_month)
    ppi_rows = {c: vintage.latest(conn, c) for c in PPI_BRIDGE} if conn is not None else {}
    ppi_rows = {c: r for c, r in ppi_rows.items() if r}
    same_month = cpi_target_month is not None and month_first(cpi_target_month) == month

    def one(label, sa_code, nsa_code, target_code, nowcast):
        actual = _actual_mom(conn, sa_code, month)
        series = sa_code
        if actual is not None:
            source, value = "actual", actual
        elif same_month and nowcast.get("mom_pct") is not None and nowcast.get("basis") == "SA":
            source, value = "nowcast", nowcast["mom_pct"]
        elif same_month and nowcast.get("mom_nsa_pct") is not None:
            # No SA factors in the store (fresh/test stores): the legacy
            # NSA-on-NSA pairing, labelled as such.
            source, value, series = "nowcast_nsa", nowcast["mom_nsa_pct"], nsa_code
        else:
            return {"mom_pct": None, "status": "unavailable", "parameters": {},
                    "bridge": None, "cpi_input": None,
                    "note": f"no {label} CPI MoM for {reference_month[:7]} "
                            f"(neither published nor nowcast)"}
        out = pce_ppi_bridge(value, reference_month, vintage.latest(conn, series),
                             vintage.latest(conn, target_code), ppi_rows)
        out.update(status="live", cpi_input={"source": source, "series": series,
                                             "mom_pct": round(value, 4)})
        return out

    headline = one("headline", "CPIAUCSL", "CPIAUCNS", "PCEPI", cpi)
    core = one("core", "CPILFESL", "CPILFENS", "PCEPILFE", cpi.get("core") or {})
    return {**headline, "reference_month": reference_month[:7], "release_date": release_date,
            "as_of": cpi.get("as_of"), "core": {**core, "reference_month": reference_month[:7]}}


def nfp_nowcast(payroll_rows, claims_rows, window: int = 60) -> dict | None:
    payroll = {d: v for d, v in payroll_rows}
    months = sorted(payroll)
    changes = {m: payroll[m] - payroll[months[i - 1]]
               for i, m in enumerate(months) if i > 0}
    if len(changes) < 4:
        return None
    claims = [v for _, v in claims_rows]
    # ICSA is raw persons; payroll changes are thousands — convert before mixing.
    claims_delta = ((sum(claims[-4:]) / 4 - sum(claims[-8:-4]) / 4) / 1000
                    if len(claims) >= 8 else 0.0)
    ordered = sorted(changes)
    rows, ys = [], []
    for i in range(3, len(ordered)):
        momentum = sum(changes[m] for m in ordered[i - 3:i]) / 3
        rows.append([1.0, momentum])
        ys.append(changes[ordered[i]])
    beta = _ols(rows[-window:], ys[-window:]) or [0.0, 1.0]
    claims_beta = -1.0  # hand-seeded: +1k claims (4wk avg) ≈ 1k fewer payrolls
    momentum = sum(changes[m] for m in ordered[-3:]) / 3
    forecast = beta[0] + beta[1] * momentum + claims_beta * claims_delta
    return {"change_thousands": round(forecast), "status": "live",
            "reference_month": next_month(months[-1])[:7],
            "parameters": {"a": round(beta[0], 6), "b": round(beta[1], 6),
                           "c": round(-claims_beta, 6), "window_months": window},
            "inputs": {"payroll_momentum": round(momentum, 2),
                       "claims_delta_thousands": round(claims_delta, 2)}}


def ensemble(forecasts: dict[str, float | None], errors: dict[str, float | None]) -> dict:
    valid = {k: v for k, v in forecasts.items() if v is not None and math.isfinite(v)}
    if not valid:
        return {"value": None, "weights": {}}
    raw = {k: 1 / max(errors.get(k) or 1.0, 0.01) for k in valid}
    denom = sum(raw.values())
    weights = {k: raw[k] / denom for k in raw}
    return {"value": round(sum(valid[k] * weights[k] for k in valid), 2),
            "weights": {k: round(v, 4) for k, v in weights.items()}}


def build_latest(conn, gauge_result: dict, next_release: dict | None,
                 benchmarks: dict[str, float | None] | None = None,
                 core_benchmarks: dict[str, dict | None] | None = None,
                 staleness: dict[str, int] | None = None,
                 today: str | None = None,
                 pce_release: dict | None = None,
                 pce_benchmarks: dict[str, dict | None] | None = None,
                 core_pce_benchmarks: dict[str, dict | None] | None = None) -> dict:
    """`pce_release` = the next PCE (Personal Income & Outlays) release,
    {date, reference_month} from release_calendar.next_target(key="pce");
    None falls back to the CPI target month (the pre-2026-09-28 pairing)."""
    if next_release is None:
        # Calendar exhausted (config/release_calendar.json needs its annual
        # refresh): degrade to an "unavailable" nowcast rather than raising —
        # a nowcast we can't compute must never take composites or gauge QA
        # down with it (see docs/plans/2026-07-11-phase-3-4-structural-risks.md).
        return {"target": "CPI", "release_date": None, "reference_month": None,
                "cpi": {"mom_pct": None, "yoy_pct": None, "as_of": None,
                        "status": "unavailable", "parameters": {},
                        "components": []},
                "pce": {"mom_pct": None, "status": "unavailable", "as_of": None,
                        "parameters": {}, "reference_month": None,
                        "core": {"mom_pct": None, "status": "unavailable",
                                 "parameters": {}, "reference_month": None}},
                "nfp": None, "benchmarks": benchmarks or {},
                "ensemble": {"value": None, "weights": {}},
                "generated_on": date.today().isoformat()}
    cpi = cpi_nowcast(gauge_result, next_release["reference_month"], conn=conn,
                      staleness=staleness, today=today)
    # PCE targets its OWN next release (BEA prints ~2 weeks after CPI): until
    # 2026-09-28 it rode the CPI nowcast's month, so the call for month t
    # froze the day the CPI nowcast rolled to t+1 — ~15 days before PCE for
    # t printed, and never used the actual CPI for t that was already out.
    pce_target = pce_release or {"date": None,
                                 "reference_month": next_release["reference_month"]}
    pce = pce_nowcast(conn, cpi, pce_target["reference_month"], pce_target["date"],
                      next_release["reference_month"])
    pce["benchmarks"] = {k: v for k, v in (pce_benchmarks or {}).items() if v is not None}
    pce["core"]["benchmarks"] = {k: v for k, v in (core_pce_benchmarks or {}).items()
                                 if v is not None}
    nfp = nfp_nowcast(vintage.latest(conn, "PAYEMS"), vintage.latest(conn, "ICSA"))
    benchmark_values = benchmarks or {}
    forecasts = {"macrogauge": cpi["mom_pct"],
                 **{name: b["value"] for name, b in benchmark_values.items()
                    if b is not None}}
    # Inverse-MAE weights once every forecaster has a graded SA record
    # (phase3.build_leaderboard); equal weights until then.
    from pipeline.publish import phase3
    errors = phase3.ensemble_errors(phase3.build_leaderboard(conn)) if conn is not None else {}
    ens = ensemble(forecasts, {name: errors.get(name) for name in forecasts})
    core_bench = {k: v for k, v in (core_benchmarks or {}).items() if v is not None}
    core_forecasts = {"macrogauge": (cpi.get("core") or {}).get("mom_pct"),
                      **{name: b["value"] for name, b in core_bench.items()}}
    core_ens = ensemble(core_forecasts, {name: None for name in core_forecasts})
    return {"target": "CPI", "release_date": next_release["date"],
            "core_benchmarks": core_bench, "core_ensemble": core_ens,
            "reference_month": next_release["reference_month"], "cpi": cpi,
            "pce": pce,
            "nfp": nfp, "benchmarks": benchmark_values, "ensemble": ens,
            "generated_on": date.today().isoformat()}
