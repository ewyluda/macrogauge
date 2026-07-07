"""BLS connector — https://www.bls.gov/developers/api_signature_v2.htm

Keyless works (25 req/day); a free registration key raises the limit.
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"


def fetch(series_ids: list[str], api_key: str | None, start_year: str = "2017",
          vintage_date: str | None = None, http_post=None) -> list[Observation]:
    http_post = http_post or requests.post
    vintage = vintage_date or today_et()
    payload = {"seriesid": series_ids, "startyear": start_year,
               "endyear": today_et()[:4]}
    if api_key:
        payload["registrationkey"] = api_key
    resp = http_post(BLS_URL, json=payload, timeout=60)
    resp.raise_for_status()
    out: list[Observation] = []
    for s in resp.json()["Results"]["series"]:
        for row in s["data"]:
            if not row["period"].startswith("M") or row["period"] == "M13":
                continue
            out.append(Observation(
                series_code=s["seriesID"],
                obs_date=f"{row['year']}-{row['period'][1:]}-01",
                value=float(row["value"]), vintage_date=vintage,
                source="BLS", route="API"))
    return out
