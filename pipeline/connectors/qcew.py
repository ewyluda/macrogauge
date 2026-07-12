"""QCEW open-data CSV connector — quarterly state wages, NAICS industry slice.

https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv returns one
row per area x ownership for that quarter. We keep own_code 5 (private) rows
whose area_fips is registered, reading avg_wkly_wage; disclosure-suppressed
rows (small-cell wages BLS zeroes out and flags via disclosure_code) are
dropped, not ingested as a real 0. Quarterly observations are dated at the
quarter's first month. Keyless. QCEW publishes with a ~5-month lag
and revises prior quarters, so each run walks the last N_QUARTERS quarters:
per-quarter failures are tolerated (the newest quarters 404 until published),
but zero loaded quarters raises — collect's isolation surfaces it. The store's
value-dedupe makes refetching unchanged quarters free.
"""
import csv
import io
from datetime import date

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

QCEW_URL = "https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv"
NAICS = "23"
N_QUARTERS = 4  # publication lag ~2 quarters + revision refresh headroom


def _recent_quarters(today: str, n: int = N_QUARTERS) -> list[tuple[int, int]]:
    d = date.fromisoformat(today)
    year, q = d.year, (d.month - 1) // 3 + 1
    out = []
    for _ in range(n):
        out.append((year, q))
        q -= 1
        if q == 0:
            year, q = year - 1, 4
    return list(reversed(out))  # oldest first


def fetch(area_fips: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    wanted = set(area_fips)
    out: list[Observation] = []
    loaded, errors = 0, []
    for year, q in _recent_quarters(vintage):
        try:
            resp = http_get(QCEW_URL.format(year=year, qtr=q, naics=NAICS),
                            timeout=120)  # industry files are large (all counties)
            resp.raise_for_status()
        except Exception as e:
            errors.append(f"{year}q{q}: {type(e).__name__}")
            continue
        loaded += 1
        for row in csv.DictReader(io.StringIO(resp.text)):
            if row["own_code"] != "5" or row["area_fips"] not in wanted:
                continue
            # BLS suppresses small cells by zeroing the value and setting
            # disclosure_code (e.g. "N") rather than omitting the row — a
            # suppressed 0 is not a real wage and must not be ingested as one.
            wage = float(row["avg_wkly_wage"])
            if row["disclosure_code"] or wage <= 0:
                continue
            month = (int(row["qtr"]) - 1) * 3 + 1
            out.append(Observation(
                series_code=row["area_fips"],
                obs_date=f"{row['year']}-{month:02d}-01",
                value=wage,
                vintage_date=vintage, source="QCEW", route="CSV"))
    if not loaded:
        raise RuntimeError(f"QCEW: no quarter loaded — {'; '.join(errors)}")
    return out
