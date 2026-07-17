"""FRED connector — https://fred.stlouisfed.org/docs/api/fred/series_observations.html"""
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from pipeline.models import Observation

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


def today_et() -> str:
    return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")


def fetch_vintages(series_id: str, api_key: str,
                   observation_start: str = "2017-01-01",
                   realtime_start: str = "2016-01-01",
                   http_get=None) -> list[Observation]:
    """Every historical vintage of a series from ALFRED (FRED realtime API).

    Each realtime window becomes one row stamped with the window's start —
    the date that value was actually released. realtime_start must predate
    the first release of observation_start's print, or ALFRED clamps the
    earliest window to it and the first-release date is lost."""
    http_get = http_get or requests.get
    resp = http_get(FRED_URL, params={
        "series_id": series_id, "api_key": api_key, "file_type": "json",
        "observation_start": observation_start,
        "realtime_start": realtime_start, "realtime_end": "9999-12-31"},
        timeout=30)
    resp.raise_for_status()
    return [Observation(series_code=series_id, obs_date=row["date"],
                        value=float(row["value"]),
                        vintage_date=row["realtime_start"],
                        source="ALFRED", route="API")
            for row in resp.json()["observations"] if row["value"] != "."]


def fetch(series_ids: list[str], api_key: str, observation_start: str = "2017-01-01",
          vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """Per-series failures are tolerated (a deleted/typo'd id 400s; carry-forward
    plus the per-series staleness/never-seen QA is the detection channel) —
    but zero loaded series raises, and collect's isolation surfaces it. Same
    convention as qcew's per-quarter tolerance."""
    throttle = http_get is None  # real network: FRED caps at 120 req/min
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    loaded, errors = 0, []
    for i, sid in enumerate(series_ids):
        if throttle and i:
            time.sleep(0.45)
        try:
            resp = http_get(FRED_URL, params={
                "series_id": sid, "api_key": api_key, "file_type": "json",
                "observation_start": observation_start}, timeout=30)
            resp.raise_for_status()
            rows = [Observation(series_code=sid, obs_date=row["date"],
                                value=float(row["value"]), vintage_date=vintage,
                                source="FRED", route="API")
                    for row in resp.json()["observations"] if row["value"] != "."]
        except Exception as e:  # per-series: one bad id must not kill the source row
            errors.append((sid, e))
            continue
        loaded += 1
        out.extend(rows)
    if not loaded and errors:
        if len(errors) == 1:  # nothing was isolated — surface the real exception
            raise errors[0][1]
        raise RuntimeError("FRED: no series loaded — " + "; ".join(
            f"{sid}: {type(e).__name__}" for sid, e in errors))
    return out
