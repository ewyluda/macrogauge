"""QCEW open-data CSV connector — quarterly state wages, NAICS industry slice.

https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv returns one
row per area x ownership for that quarter. We keep own_code 5 (private) rows
whose area_fips is registered, reading avg_wkly_wage and month3_emplvl (the
latter under the "{fips}~emp" series code); disclosure-suppressed rows
(small-cell values BLS zeroes out and flags via disclosure_code) are dropped
whole — neither a real 0 wage nor a real 0 headcount. Area is a plain row
filter with no agglvl check, so county FIPS work with no code change.
Quarterly observations are dated at the quarter's first month. Keyless.
QCEW publishes with a ~5-month lag
and revises prior quarters, so each run walks the last N_QUARTERS quarters:
per-quarter failures are tolerated — HTTP errors AND bodies that fail to parse
as the expected CSV (the newest quarters 404 until published; a 200 HTML
maintenance page must not discard the other quarters) — but zero loaded
quarters raises, and collect's isolation surfaces it. The store's
value-dedupe makes refetching unchanged quarters free.
"""
import csv
import io
from datetime import date

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import warn_partial
from pipeline.models import Observation

QCEW_URL = "https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv"
NAICS = "23"
EMP_SUFFIX = "~emp"  # employment rides as its own series code rather than a
                     # new Observation field: store rows are append-only and
                     # schema-versionless, and collect.py's id_map is a plain
                     # string map so it needs no change.
N_QUARTERS = 8  # must span the newest PUBLISHED quarter (q0-3 at a ~2-quarter
                # lag) AND its year-ago base (q0-7), or wage YoY is
                # uncomputable — geo.json shipped yoy_pct: null for all 51
                # states until this was widened. Unpublished quarters 404 and
                # are tolerated per-quarter; refetching unchanged quarters is
                # free thanks to the store's value-dedupe.


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


def _parse_quarter(text: str, wanted: set[str], vintage: str) -> list[Observation]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "own_code" not in reader.fieldnames:
        raise ValueError("unexpected CSV structure (drift?)")
    out: list[Observation] = []
    for row in reader:
        fips = row["area_fips"]
        if row["own_code"] != "5":
            continue
        wage_code, emp_code = fips, f"{fips}{EMP_SUFFIX}"
        if wage_code not in wanted and emp_code not in wanted:
            continue
        # BLS suppresses small cells by zeroing the value and setting
        # disclosure_code (e.g. "N") rather than omitting the row — a
        # suppressed 0 is not a real wage OR a real headcount, and must not be
        # ingested as one. Checked BEFORE float(): a suppressed row may carry
        # a blank field. Suppression is all-or-nothing per row, so this gates
        # both metrics.
        if row["disclosure_code"]:
            continue
        month = (int(row["qtr"]) - 1) * 3 + 1
        obs_date = f"{row['year']}-{month:02d}-01"

        def _emit(code: str, raw: str) -> None:
            value = float(raw)
            if value <= 0:
                return
            out.append(Observation(
                series_code=code, obs_date=obs_date, value=value,
                vintage_date=vintage, source="QCEW", route="CSV"))

        if wage_code in wanted:
            _emit(wage_code, row["avg_wkly_wage"])
        if emp_code in wanted:
            _emit(emp_code, row["month3_emplvl"])
    return out


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
            rows = _parse_quarter(resp.text, wanted, vintage)
        except Exception as e:  # per-quarter: never discard the other quarters
            errors.append((f"{year}q{q}", e))
            continue
        loaded += 1
        out.extend(rows)
    if not loaded:
        raise RuntimeError("QCEW: no quarter loaded — " + "; ".join(
            f"{q}: {type(e).__name__}" for q, e in errors))
    warn_partial("QCEW", errors)
    return out
