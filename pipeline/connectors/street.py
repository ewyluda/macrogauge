"""FMP economic-calendar street consensus for the next CPI release."""
from datetime import date, timedelta

import requests

from pipeline.connectors.fred import today_et
from pipeline.dates import month_first, prior_month
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
        if str(row.get("country", "")).upper() != "US":
            continue  # many countries publish a "Consumer Price Index MoM"
        name = str(row.get("event", row.get("name", ""))).lower()
        if "core" in name:
            continue  # Core CPI sits next to headline in the calendar
        if not ("consumer price index" in name and ("month" in name or "mom" in name)):
            continue
        estimate = row.get("estimate")
        if estimate is None:
            estimate = row.get("consensus")  # estimate:null + populated consensus
        if estimate is None:
            continue
        # obs_date = reference-month first: a CPI release always covers the
        # prior calendar month (shared benchmark store convention).
        reference = prior_month(month_first(row["date"][:10]))
        return [Observation("street_cpi_mom", reference, float(estimate),
                            vintage, "STREET", "API")]
    raise ValueError("no CPI monthly consensus in FMP calendar")
