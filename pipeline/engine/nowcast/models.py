"""Deterministic CPI, PCE, NFP and ensemble nowcasts.

The functions are deliberately dependency-free and expose every fitted or
hand-seeded parameter in their results. Missing benchmark inputs are omitted,
never imputed.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from pipeline.store import vintage

CPI_PARAMS = {"fuel_beta": 0.85, "rent_lag_months": 12, "rent_w": 0.45}


def _month_start(month: str) -> str:
    return f"{month[:7]}-01"


def _previous_month(month: str) -> str:
    y, m = map(int, month[:7].split("-"))
    return f"{y - (m == 1):04d}-{12 if m == 1 else m - 1:02d}-01"


def _next_month(month: str) -> str:
    y, m = map(int, month[:7].split("-"))
    return f"{y + (m == 12):04d}-{1 if m == 12 else m + 1:02d}-01"


def _pct_change(values: dict[str, float], end: str, start: str) -> float | None:
    if end not in values or start not in values or values[start] == 0:
        return None
    return (values[end] / values[start] - 1) * 100


def cpi_nowcast(gauge_result: dict, target_month: str) -> dict:
    """Bottom-up CPI forecast from weighted component index changes."""
    target = _month_start(target_month)
    prior = _previous_month(target)
    after = _next_month(target)
    variant = gauge_result["variants"]["gauge"]
    contributions, total = [], 0.0
    for code, component in variant["components"].items():
        series = component["daily_index"]
        # Never read past the target month: once it is over, later moves belong
        # to the NEXT print, and this forecast gets graded against a one-month
        # actual.
        end = min(variant["as_of"],
                  max((d for d in series if d < after), default=max(series)))
        # If target is not complete, compare the latest in-month reading with
        # the prior month start. Sticky categories naturally contribute zero.
        start = prior if prior in series else max(d for d in series if d < end)
        move = _pct_change(series, end, start) or 0.0
        contribution = component["weight"] * move
        contributions.append({"component": code, "mom_pct": round(move, 4),
                              "weight": component["weight"],
                              "contribution_pp": round(contribution, 4)})
        total += contribution
    latest_yoy = variant["yoy"][variant["as_of"]]
    return {"target_month": target[:7], "mom_pct": round(total, 2),
            "yoy_pct": round(latest_yoy, 2), "as_of": variant["as_of"],
            "status": "live", "parameters": CPI_PARAMS,
            "components": contributions}


def _monthly_changes(rows: list[tuple[str, float]]) -> dict[str, float]:
    levels = dict(rows)
    out = {}
    for month, value in levels.items():
        prior = _previous_month(month)
        if prior in levels and levels[prior]:
            out[month] = (value / levels[prior] - 1) * 100
    return out


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
    cpi, pce = _monthly_changes(cpi_rows), _monthly_changes(pce_rows)
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
                 benchmarks: dict[str, float | None] | None = None) -> dict:
    if next_release is None:
        # Calendar exhausted (config/release_calendar.json needs its annual
        # refresh): degrade to an "unavailable" nowcast rather than raising —
        # a nowcast we can't compute must never take composites or gauge QA
        # down with it (see docs/plans/2026-07-11-phase-3-4-structural-risks.md).
        return {"target": "CPI", "release_date": None, "reference_month": None,
                "cpi": {"mom_pct": None, "yoy_pct": None, "as_of": None,
                        "status": "unavailable", "parameters": CPI_PARAMS,
                        "components": []},
                "pce": {"mom_pct": None, "status": "unavailable", "as_of": None,
                        "parameters": {}},
                "nfp": None, "benchmarks": benchmarks or {},
                "ensemble": {"value": None, "weights": {}},
                "generated_on": date.today().isoformat()}
    cpi = cpi_nowcast(gauge_result, next_release["reference_month"])
    pce = pce_bridge(cpi["mom_pct"], vintage.latest(conn, "CPIAUCNS"),
                     vintage.latest(conn, "PCEPI"))
    nfp = nfp_nowcast(vintage.latest(conn, "PAYEMS"), vintage.latest(conn, "ICSA"))
    benchmark_values = benchmarks or {}
    forecasts = {"macrogauge": cpi["mom_pct"], **benchmark_values}
    ens = ensemble(forecasts, {name: None for name in forecasts})
    return {"target": "CPI", "release_date": next_release["date"],
            "reference_month": next_release["reference_month"], "cpi": cpi,
            "pce": {**pce, "status": "live", "as_of": cpi["as_of"]},
            "nfp": nfp, "benchmarks": benchmark_values, "ensemble": ens,
            "generated_on": date.today().isoformat()}
