"""FMP connector — batch quote for futures proxies (gold, WTI).


Note: `stable/quote` only accepts a single symbol — a comma-joined `symbol`
silently returns `[]` (verified live). The multi-symbol batch route is
`stable/batch-quote` with a `symbols` (plural) param.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

QUOTE_URL = "https://financialmodelingprep.com/stable/batch-quote"
HISTORY_URL = "https://financialmodelingprep.com/stable/historical-price-eod/light"


def fetch(symbols: list[str], api_key: str, vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(QUOTE_URL, params={"symbols": ",".join(symbols),
                                       "apikey": api_key}, timeout=60)
    resp.raise_for_status()
    out: list[Observation] = []
    for row in resp.json():
        obs_date = datetime.fromtimestamp(
            row["timestamp"], ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
        out.append(Observation(series_code=row["symbol"], obs_date=obs_date,
                               value=float(row["price"]), vintage_date=vintage,
                               source="FMP", route="API"))
    return out


def fetch_history(symbols: list[str], api_key: str, from_date: str = "2017-01-01",
                  vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """One-time backfill route (Phase 2a): daily closes since from_date.

    Vintage = today: we learned the history today; never backdate vintages."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    for sym in symbols:
        resp = http_get(HISTORY_URL, params={"symbol": sym, "from": from_date,
                                             "apikey": api_key}, timeout=120)
        resp.raise_for_status()
        for row in resp.json():
            out.append(Observation(series_code=sym, obs_date=row["date"],
                                   value=float(row["price"]), vintage_date=vintage,
                                   source="FMP", route="API"))
    return out
