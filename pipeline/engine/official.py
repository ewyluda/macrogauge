"""Trivial Phase-0 engine: YoY from the latest official monthly index print."""
import sqlite3

from pipeline.store import vintage


def _months_back(obs_date: str, n: int) -> str:
    """First-of-month date n months before obs_date (FRED monthly dates are YYYY-MM-01)."""
    year, month = int(obs_date[:4]), int(obs_date[5:7])
    total = year * 12 + (month - 1) - n
    return f"{total // 12:04d}-{total % 12 + 1:02d}-01"


def latest_yoy(conn: sqlite3.Connection, series_code: str) -> dict:
    series = dict(vintage.latest(conn, series_code))
    if not series:
        raise ValueError(f"no observations for {series_code}")
    month = max(series)

    def yoy(m: str) -> float:
        base = _months_back(m, 12)
        if base not in series:
            raise ValueError(f"missing base month {base} for {series_code}")
        return (series[m] / series[base] - 1) * 100

    prev_month = _months_back(month, 1)
    if prev_month not in series:
        raise ValueError(f"missing prior month {prev_month} for {series_code}")
    return {"series_code": series_code, "month": month, "yoy_pct": yoy(month),
            "prev_yoy_pct": yoy(prev_month),
            "as_of": vintage.max_vintage(conn, series_code)}
