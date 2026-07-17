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
    for code, component in variant["components"].items():
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
        contribution = component["weight"] * move
        row = {"component": code, "mom_pct": round(move, 4),
               "weight": component["weight"],
               "contribution_pp": round(contribution, 4), "basis": basis}
        if driver_mom is not None:
            row["driver_mom_pct"] = round(driver_mom, 4)
        contributions.append(row)
        total += contribution
    latest_yoy = variant["yoy"][variant["as_of"]]
    return {"target_month": target[:7], "mom_pct": round(total, 2),
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
                 staleness: dict[str, int] | None = None,
                 today: str | None = None) -> dict:
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
                        "parameters": {}},
                "nfp": None, "benchmarks": benchmarks or {},
                "ensemble": {"value": None, "weights": {}},
                "generated_on": date.today().isoformat()}
    cpi = cpi_nowcast(gauge_result, next_release["reference_month"], conn=conn,
                      staleness=staleness, today=today)
    pce = pce_bridge(cpi["mom_pct"], vintage.latest(conn, "CPIAUCNS"),
                     vintage.latest(conn, "PCEPI"))
    nfp = nfp_nowcast(vintage.latest(conn, "PAYEMS"), vintage.latest(conn, "ICSA"))
    benchmark_values = benchmarks or {}
    forecasts = {"macrogauge": cpi["mom_pct"],
                 **{name: b["value"] for name, b in benchmark_values.items()
                    if b is not None}}
    ens = ensemble(forecasts, {name: None for name in forecasts})
    return {"target": "CPI", "release_date": next_release["date"],
            "reference_month": next_release["reference_month"], "cpi": cpi,
            "pce": {**pce, "status": "live", "as_of": cpi["as_of"]},
            "nfp": nfp, "benchmarks": benchmark_values, "ensemble": ens,
            "generated_on": date.today().isoformat()}
