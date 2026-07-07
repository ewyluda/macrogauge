"""FRED connector — https://fred.stlouisfed.org/docs/api/fred/series_observations.html"""
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from pipeline.models import Observation

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


def today_et() -> str:
    return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")


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
