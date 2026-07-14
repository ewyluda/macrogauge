"""Shared trend/driver signal math for the outlook and the one-month nowcast.

Extracted verbatim from outlook.py (2026-07-14) so the nowcast can reuse the
same trailing-median trend and futures-driver arithmetic without cross-module
private imports. One set of pass-through beliefs lives in config/outlook.json;
this module is the one implementation of the math that applies them.
"""
from __future__ import annotations

import statistics
from datetime import date

from pipeline.dates import months_back, prior_month
from pipeline.store import vintage


def month_values(rows, through_month: str | None = None) -> dict[str, float]:
    """Last observation in each complete month, keyed YYYY-MM."""
    out: dict[str, tuple[str, float]] = {}
    for obs_date, value in rows:
        month = obs_date[:7]
        if through_month is not None and month > through_month:
            continue
        if month not in out or obs_date >= out[month][0]:
            out[month] = (obs_date, float(value))
    return {month: pair[1] for month, pair in sorted(out.items())}


def month_asof(rows, through_month: str) -> str | None:
    dates = [d for d, _ in rows if d[:7] <= through_month]
    return max(dates) if dates else None


def adjacent_changes(levels: dict[str, float]) -> list[tuple[str, float]]:
    out = []
    for month, value in levels.items():
        prior = prior_month(f"{month}-01")[:7]
        base = levels.get(prior)
        if base not in (None, 0):
            out.append((month, (value / base - 1) * 100))
    return out


def median_mom(levels: dict[str, float], window: int, fallback: float = 0.0) -> float:
    changes = [value for _, value in adjacent_changes(levels)[-window:]]
    return statistics.median(changes) if changes else fallback


def lookback_return(rows, through_month: str, lookback_months: int) -> tuple[float | None, str | None]:
    levels = month_values(rows, through_month)
    if not levels:
        return None, None
    end_month = max(levels)
    start_month = months_back(f"{end_month}-01", lookback_months)[:7]
    if start_month not in levels or levels[start_month] == 0:
        return None, end_month
    return (levels[end_month] / levels[start_month] - 1) * 100, end_month


def fresh_series(rows, code: str, staleness: dict[str, int] | None,
                 today: str | None) -> bool:
    """A stale driver series must not produce a forward shock: its months-old
    move already passed through actual CPI, and lookback_return anchors at
    the series' own last month, so it would be re-applied as if it just
    happened (published 'live'). Gate on the registry's max_staleness_days;
    with no gating context (unit tests, unregistered code) treat as fresh."""
    if staleness is None or today is None:
        return True
    limit = staleness.get(code)
    if limit is None:
        return True
    last = max((obs_date for obs_date, _ in rows), default=None)
    if last is None:
        return False
    return (date.fromisoformat(today) - date.fromisoformat(last)).days <= limit


def weighted_signal(conn, series_weights: dict[str, float], through_month: str,
                    lookback_months: int, staleness: dict[str, int] | None = None,
                    today: str | None = None) -> tuple[float | None, list[str], str | None]:
    available: list[tuple[str, float, float, str | None]] = []
    for code, weight in series_weights.items():
        rows = vintage.latest(conn, code)
        if not fresh_series(rows, code, staleness, today):
            continue
        value, _ = lookback_return(rows, through_month, lookback_months)
        if value is not None:
            available.append((code, weight, value, month_asof(rows, through_month)))
    if not available:
        return None, [], None
    total = sum(weight for _, weight, _, _ in available)
    signal = sum(weight * value for _, weight, value, _ in available) / total
    asof = max((date for *_, date in available if date is not None), default=None)
    return signal, [code for code, *_ in available], asof


def equal_signal(conn, codes: list[str], through_month: str,
                 lookback_months: int, staleness: dict[str, int] | None = None,
                 today: str | None = None) -> tuple[float | None, list[str], str | None]:
    return weighted_signal(conn, {code: 1.0 for code in codes},
                           through_month, lookback_months, staleness, today)


def distributed_return(total_return_pct: float, months: int) -> float:
    # A bad upstream price can never turn a component level negative.
    bounded = max(total_return_pct, -95.0)
    return ((1 + bounded / 100) ** (1 / months) - 1) * 100


def annualized(return_pct: float, months: int) -> float:
    bounded = max(return_pct, -95.0)
    return ((1 + bounded / 100) ** (12 / months) - 1) * 100


def monthly_from_annual(annual_pct: float) -> float:
    bounded = max(annual_pct, -95.0)
    return ((1 + bounded / 100) ** (1 / 12) - 1) * 100


def component_trend_levels(component: dict, through_month: str) -> dict[str, float]:
    # Trend estimation must stop at the component's own last real observation:
    # past it the daily grid is pure forward-fill, so every adjacent-month
    # "change" is a fabricated 0.0 that drags the trailing median toward zero
    # (the same like-month rule behind the gauge's own component YoY).
    last_real_month = component["last_obs"][:7]
    return month_values(component["daily_index"].items(),
                        min(through_month, last_real_month))
