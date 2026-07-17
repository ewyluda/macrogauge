"""Trivial Phase-0 engine: YoY from the latest official monthly index print."""
import sqlite3
from datetime import date, timedelta

from pipeline.dates import months_back as _months_back
from pipeline.store import vintage


def latest_yoy(conn: sqlite3.Connection, series_code: str) -> dict:
    """YoY of the latest computable month (a month can lack its YoY base:
    the 2025-10 print was never published due to the government shutdown)."""
    series = dict(vintage.latest(conn, series_code))
    if not series:
        raise ValueError(f"no observations for {series_code}")

    def yoy(m: str) -> float:
        return (series[m] / series[_months_back(m, 12)] - 1) * 100

    computable = [m for m in sorted(series, reverse=True)
                  if _months_back(m, 12) in series]
    if len(computable) < 2:
        raise ValueError(f"need two YoY-computable months for {series_code}")
    return {"series_code": series_code, "month": computable[0],
            "yoy_pct": yoy(computable[0]), "prev_yoy_pct": yoy(computable[1]),
            "as_of": vintage.max_vintage(conn, series_code)}


QUOTE_BASE_TOLERANCE_DAYS = 60  # a YoY base older than this before target is meaningless


def component_summary(conn: sqlite3.Connection, series_code: str) -> dict:
    """YoY + MoM for the latest month where both references exist (unrounded)."""
    series = dict(vintage.latest(conn, series_code))
    if not series:
        raise ValueError(f"no observations for {series_code}")
    candidates = [m for m in sorted(series, reverse=True)
                  if _months_back(m, 12) in series and _months_back(m, 1) in series]
    if not candidates:
        raise ValueError(f"no YoY+MoM-computable month for {series_code}")
    month = candidates[0]
    return {"code": series_code, "month": month,
            "yoy_pct": (series[month] / series[_months_back(month, 12)] - 1) * 100,
            "mom_pct": (series[month] / series[_months_back(month, 1)] - 1) * 100}


def latest_quote(conn: sqlite3.Connection, series_code: str) -> dict:
    """Latest value of any-cadence series + YoY vs the nearest obs <= 365d ago."""
    rows = vintage.latest(conn, series_code)
    if not rows:
        raise ValueError(f"no observations for {series_code}")
    obs_date, latest = rows[-1]
    target = (date.fromisoformat(obs_date) - timedelta(days=365)).isoformat()
    base = [(d, v) for d, v in rows if d <= target]
    yoy = delta = None
    if base:
        base_date, base_val = base[-1]
        gap = (date.fromisoformat(target) - date.fromisoformat(base_date)).days
        if gap <= QUOTE_BASE_TOLERANCE_DAYS and base_val:
            yoy = (latest / base_val - 1) * 100
            # for %-denominated series (mortgage rate) the conventional
            # change metric is percentage POINTS, not a %-of-a-% ratio
            delta = latest - base_val
    return {"code": series_code, "latest": latest, "obs_date": obs_date,
            "yoy_pct": yoy, "yoy_delta": delta}
