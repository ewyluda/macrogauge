"""SPP day-ahead LMP by settlement location — hub daily average.

Keyless public file from the SPP Marketplace portal's file-browser API (the
path is not documented; it is the one the portal's own JavaScript calls,
verified 2026-10-04). One ~4 MB CSV per delivery day, posted ~1:15-1:45 PM
CT the day before; a missing day is a 404 with an empty body (skip).

Gotchas pinned by research/iso-samples:
- the source name is `da-lmp-by-settlement-location` (`da-lmp-by-location`
  404s);
- `Interval` is hour-ENDING, so HE24 is stamped the next calendar day at
  00:00 — rows are taken from the requested day's file, never filtered by
  the Interval date;
- the file also carries SWPW (Western) rows — filter BAA == "SPP". Files
  from before the western expansion (e.g. 2025) have no BAA column at all;
  every row in them is SPP;
- fall-back DST days carry 25 rows;
- some days ship upper-case, underscored headers (2026-06-04:
  SETTLEMENT_LOCATION), so header names are matched case- and
  underscore-insensitively.
Verified: SPPNORTH_HUB 2026-10-04 = 36.05, SPPSOUTH_HUB = 32.16."""
import csv
import io

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.lmp import daily_obs, window

URL = ("https://portal.spp.org/file-browser-api/download/da-lmp-by-settlement-location"
       "?path=/{y}/{m}/By_Day/DA-LMP-SL-{d}0100.csv")
LOC_COL, BAA_COL, PRICE_COL = "SETTLEMENT LOCATION", "BAA", "LMP"


def _norm(col: str) -> str:
    return " ".join(col.replace("_", " ").split()).upper()
PLAUSIBLE = (-100.0, 3000.0)
CATCHUP_DAYS = 4


def _default_get(url, timeout=120):
    return requests.get(url, timeout=timeout, headers={"User-Agent": "macrogauge (data pipeline)"})


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None, market_date: str | None = None) -> list:
    """source_id = the Settlement Location name (e.g. SPPNORTH_HUB)."""
    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    days = [market_date] if market_date else window(CATCHUP_DAYS)
    out = []
    for day in days:
        y, m, d = day.split("-")
        resp = http_get(URL.format(y=y, m=m, d=f"{y}{m}{d}"), timeout=120)
        if getattr(resp, "status_code", 200) == 404:
            continue
        resp.raise_for_status()
        out.extend(parse(resp.text, source_ids, day, vintage))
    return out


def parse(text: str, source_ids: list[str], day: str, vintage: str) -> list:
    reader = csv.DictReader(io.StringIO(text))
    cols = [_norm(c) for c in (reader.fieldnames or [])]
    reader.fieldnames = cols
    if LOC_COL not in cols or PRICE_COL not in cols:
        raise ValueError(f"spp: columns {cols} lack {LOC_COL}/{PRICE_COL} (structure drift?)")
    has_baa = BAA_COL in cols
    wanted = set(source_ids)
    vals: dict[str, list[str]] = {h: [] for h in source_ids}
    for r in reader:
        loc = (r.get(LOC_COL) or "").strip()
        if loc in wanted and (not has_baa or (r.get(BAA_COL) or "").strip() == "SPP"):
            vals[loc].append(r[PRICE_COL])
    out = []
    for hub in source_ids:
        if not vals[hub]:
            raise ValueError(f"spp {hub}: hub not found for {day} (structure drift?)")
        out.append(daily_obs("SPP", hub, day, vals[hub], vintage, PLAUSIBLE))
    return out
