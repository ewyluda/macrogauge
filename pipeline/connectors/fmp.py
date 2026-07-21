"""FMP connector — batch quote for futures proxies (gold, WTI).


Note: `stable/quote` only accepts a single symbol — a comma-joined `symbol`
silently returns `[]` (verified live). The multi-symbol batch route is
`stable/batch-quote` with a `symbols` (plural) param.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import warn_partial
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


# Plausibility rails for the /capacity equity batch — a corrupted response
# (unit change, zeroed marketCap) is skipped per-item, not ingested.
PX_MAX = 100_000.0
CAP_MAX_B = 10_000.0  # $10T


def fetch_equity(source_ids: list[str], api_key: str,
                 vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """Equity price + market cap for /capacity. source_ids are "SYM:px" /
    "SYM:cap" (collect_all remaps to fmp_px_* / fmp_cap_*). Cap lands in $B.
    Implausible or missing quotes surface via warn_partial — one bad ticker
    never drops the batch."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    wanted = set(source_ids)
    symbols = sorted({sid.split(":", 1)[0] for sid in source_ids})
    resp = http_get(QUOTE_URL, params={"symbols": ",".join(symbols),
                                       "apikey": api_key}, timeout=60)
    resp.raise_for_status()
    out: list[Observation] = []
    errors: list[tuple[str, Exception]] = []
    seen: set[str] = set()
    for row in resp.json():
        sym = row.get("symbol")
        seen.add(sym)
        obs_date = datetime.fromtimestamp(
            row["timestamp"], ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
        if f"{sym}:px" in wanted:
            px = row.get("price")
            if isinstance(px, (int, float)) and 0 < px < PX_MAX:
                out.append(Observation(series_code=f"{sym}:px", obs_date=obs_date,
                                       value=float(px), vintage_date=vintage,
                                       source="FMP_EQ", route="API"))
            else:
                errors.append((f"{sym}:px", ValueError(f"implausible price {px!r}")))
        if f"{sym}:cap" in wanted:
            cap_b = (row.get("marketCap") or 0) / 1e9
            if 0 < cap_b < CAP_MAX_B:
                out.append(Observation(series_code=f"{sym}:cap", obs_date=obs_date,
                                       value=round(cap_b, 2), vintage_date=vintage,
                                       source="FMP_EQ", route="API"))
            else:
                errors.append((f"{sym}:cap",
                               ValueError(f"implausible marketCap {row.get('marketCap')!r}")))
    errors.extend((s, ValueError("no quote in batch response"))
                  for s in symbols if s not in seen)
    warn_partial("FMP_EQ", errors)
    return out
