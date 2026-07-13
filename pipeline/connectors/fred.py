"""FRED connector — https://fred.stlouisfed.org/docs/api/fred/series_observations.html"""
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
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    for sid in series_ids:
        resp = http_get(FRED_URL, params={
            "series_id": sid, "api_key": api_key, "file_type": "json",
            "observation_start": observation_start}, timeout=30)
        resp.raise_for_status()
        for row in resp.json()["observations"]:
            if row["value"] == ".":
                continue
            out.append(Observation(series_code=sid, obs_date=row["date"],
                                   value=float(row["value"]), vintage_date=vintage,
                                   source="FRED", route="API"))
    return out
