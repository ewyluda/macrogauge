"""FMP economic-calendar street consensus for the next CPI release."""
from datetime import date, timedelta

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://financialmodelingprep.com/stable/economic-calendar"


def fetch(api_key: str, vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    response = http_get(URL, params={"from": vintage,
                                     "to": (date.fromisoformat(vintage) + timedelta(days=45)).isoformat(),
                                     "apikey": api_key}, timeout=30)
    response.raise_for_status()
    for row in response.json():
        name = str(row.get("event", row.get("name", ""))).lower()
        estimate = row.get("estimate", row.get("consensus"))
        if "consumer price index" in name and ("month" in name or "mom" in name) and estimate is not None:
            return [Observation("street_cpi_mom", row["date"][:10], float(estimate),
                                vintage, "STREET", "API")]
    raise ValueError("no CPI monthly consensus in FMP calendar")
