"""QCEW open-data CSV connector — quarterly state wages, NAICS industry slice.

https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv returns one
row per area x ownership for that quarter. We keep own_code 5 (private) rows
whose area_fips is registered, reading avg_wkly_wage, month3_emplvl (under
the "{fips}~emp" series code) and average monthly employment — (month1 +
month2 + month3) / 3, under "{fips}~aemp" — BLS's own denominator for
avg_wkly_wage, and the correct wage weight for multi-county aggregation
(dcmarkets.py); disclosure-suppressed rows (small-cell values BLS zeroes out
and flags via disclosure_code) are dropped whole — neither a real 0 wage nor
a real 0 headcount. Area is a plain row filter with no agglvl check, so
county FIPS work with no code change.
Quarterly observations are dated at the quarter's first month. Keyless.
QCEW publishes with a ~5-month lag
and revises prior quarters, so each run walks the last N_QUARTERS quarters:
per-quarter failures are tolerated — HTTP errors AND bodies that fail to parse
as the expected CSV (the newest quarters 404 until published; a 200 HTML
maintenance page must not discard the other quarters) — but zero loaded
quarters raises, and collect's isolation surfaces it. The store's
value-dedupe makes refetching unchanged quarters free.

The NAICS code is a parameter (default "23", the construction sector every
pre-existing QCEW series rides). NAICS 238212 -- NONRESIDENTIAL electrical
contractors; NAICS 2022 split the old 238210 into 238211 residential and
238212 nonresidential -- is collected under its own source key
(QCEW_238212) for failure isolation and its own status row, from the SAME
industry-slice endpoint: verified live 2026-10-01, /industry/238212.csv
serves every county at agglvl 78 (county x 6-digit), every state at 58 and
the US at 18, one file per quarter, so no per-county area-file fan-out is
needed. A 6-digit pull also carries drift guards the NAICS 23 path predates
(and stays byte-identical without): industry_code must be the one
requested, agglvl must match the area's level, and wage/headcount must sit
inside a plausible range -- a violation raises "structure drift?" for that
quarter, which the per-quarter tolerance turns into a partial warning
instead of garbage in the store.
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
NAICS_ELEC = "238212"  # nonresidential electrical contractors (NAICS 2022)

# Drift guards for 6-digit pulls, keyed by NAICS. NAICS 23 is deliberately
# absent: its path predates the guards and must stay byte-identical.
# Ranges are generous on purpose -- they catch a mis-parsed column (a wage
# landing in the headcount field, cents for dollars), not a hot market: the
# live 2024Q1-2026Q1 DC-county 238212 wages ran $1,091-$6,492/wk (Santa
# Clara 2024Q3 the outlier) and the US private headcount ~0.8M.
_GUARDS = {NAICS_ELEC: {"wage": (200.0, 15000.0), "emp": (1.0, 3_000_000.0)}}
# agglvl_code by area level in a 6-digit industry slice (QCEW agglvl titles:
# 18 = national x 6-digit, 58 = state x 6-digit, 78 = county x 6-digit).
_AGGLVL_6 = {"us": "18", "state": "58", "county": "78"}
EMP_SUFFIX = "~emp"  # employment rides as its own series code rather than a
                     # new Observation field: store rows are append-only and
                     # schema-versionless, and collect.py's id_map is a plain
                     # string map so it needs no change.
AEMP_SUFFIX = "~aemp"  # average MONTHLY employment ((m1+m2+m3)/3) -- BLS's
                     # own denominator for avg_wkly_wage, established
                     # empirically: total_qtrly_wages/((m1+m2+m3)/3)/13
                     # reproduces published avg_wkly_wage within integer
                     # rounding for 100% of rows, vs ~2-3% for a month3
                     # denominator. Weighting county avg_wkly_wage by this
                     # average is algebraically the wage-weighted mean BLS
                     # itself would publish for the combined area, so no
                     # need to also ingest total_qtrly_wages. Same evolution
                     # path as ~emp: a new series code, not a new
                     # Observation field.
N_QUARTERS = 10  # N = 8 + k, where k is the number of consecutive
                # disclosure-suppressed LATEST quarters a series must
                # tolerate before its own year-ago base falls outside the
                # window. Downstream, a series' "as_of" is its OWN latest
                # observation (geo.py/dc_markets.py take max(obs), not
                # wall-clock "today"), and the YoY base is looked up at
                # exactly as_of-12mo with no tolerance (util.py) -- so the
                # window must reach 12 months behind whatever quarter a
                # series actually last published, not just behind the
                # newest quarter BLS published for anyone.
                #
                # k=0 (a series' latest obs IS the newest BLS-published
                # quarter, q0-3 at the ~5-month lag) needs exactly 8: q0-7
                # (the year-ago base) .. q0. That's how 8 was chosen, and it
                # shipped with ZERO slack -- geo.json's yoy_pct was null for
                # all 51 states until N=8 first landed, then broke again on
                # the first state (Louisiana) whose latest quarter flickered
                # suppressed (k=1, latest=q0-4, base=q0-8 -- one past the
                # N=8 window). qcew_wage23_c41067 (Washington Co. OR /
                # Hillsboro) is suppressed TWO consecutive quarters (k=2,
                # base=q0-9) -- hence 10. Widen N by 1 for every additional
                # consecutive suppression this basket needs to tolerate.
                #
                # Rejected alternative: re-anchor the window at q0-1 with
                # N=9 -- same coverage, one fewer request/day -- by betting
                # that q0-1/q0/q0+1 (2026Q1-Q3, from "today") are guaranteed
                # 404s at BLS's ~5-month lag. Do NOT do this: it bets on
                # that lag never shortening, and if it did, this basket
                # would silently sit a quarter behind for months with no
                # visible symptom. Two extra requests/day is the right price
                # for not making that bet.
                #
                # Unpublished quarters 404 and are tolerated per-quarter;
                # refetching unchanged quarters is free thanks to the
                # store's value-dedupe.


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


def _area_level(fips: str) -> str:
    if fips == "US000":
        return "us"
    return "state" if fips.endswith("000") else "county"


def _check_row(row: dict, naics: str, guard: dict) -> None:
    """6-digit drift guards (see _GUARDS). Raises ValueError, so the quarter
    is tolerated-and-reported, never ingested."""
    where = f"{row['area_fips']} {row['year']}q{row['qtr']}"
    if row["industry_code"] != naics:
        raise ValueError(f"industry_code {row['industry_code']!r} != {naics} "
                         f"at {where} (structure drift?)")
    want_lvl = _AGGLVL_6[_area_level(row["area_fips"])]
    if row["agglvl_code"] != want_lvl:
        raise ValueError(f"agglvl_code {row['agglvl_code']!r} != {want_lvl} "
                         f"at {where} (structure drift?)")
    for field, (lo, hi) in (("avg_wkly_wage", guard["wage"]),
                            ("month1_emplvl", guard["emp"]),
                            ("month2_emplvl", guard["emp"]),
                            ("month3_emplvl", guard["emp"])):
        v = float(row[field])
        if not lo <= v <= hi:
            raise ValueError(f"implausible {field} {v:g} at {where} "
                             f"(outside {lo:g}-{hi:g}; structure drift?)")


def _parse_quarter(text: str, wanted: set[str], vintage: str,
                   naics: str = NAICS, source: str = "QCEW") -> list[Observation]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "own_code" not in reader.fieldnames:
        raise ValueError("unexpected CSV structure (drift?)")
    guard = _GUARDS.get(naics)
    out: list[Observation] = []
    for row in reader:
        fips = row["area_fips"]
        if row["own_code"] != "5":
            continue
        wage_code = fips
        emp_code = f"{fips}{EMP_SUFFIX}"
        aemp_code = f"{fips}{AEMP_SUFFIX}"
        if wage_code not in wanted and emp_code not in wanted and aemp_code not in wanted:
            continue
        # BLS suppresses small cells by zeroing the value and setting
        # disclosure_code (e.g. "N") rather than omitting the row — a
        # suppressed 0 is not a real wage OR a real headcount, and must not be
        # ingested as one. Checked BEFORE float(): a suppressed row may carry
        # a blank field. Suppression is all-or-nothing per row, so this gates
        # all three metrics.
        if row["disclosure_code"]:
            continue
        if guard is not None:
            _check_row(row, naics, guard)
        month =(int(row["qtr"]) - 1) * 3 + 1
        obs_date = f"{row['year']}-{month:02d}-01"

        def _emit(code: str, value: float) -> None:
            if value <= 0:
                return
            out.append(Observation(
                series_code=code, obs_date=obs_date, value=value,
                vintage_date=vintage, source=source, route="CSV"))

        if wage_code in wanted:
            _emit(wage_code, float(row["avg_wkly_wage"]))
        if emp_code in wanted:
            _emit(emp_code, float(row["month3_emplvl"]))
        if aemp_code in wanted:
            avg_emp = (float(row["month1_emplvl"]) + float(row["month2_emplvl"])
                      + float(row["month3_emplvl"])) / 3
            _emit(aemp_code, avg_emp)
    return out


def fetch(area_fips: list[str], vintage_date: str | None = None,
          http_get=None, naics: str = NAICS,
          source: str = "QCEW") -> list[Observation]:
    """`naics` picks the industry slice; `source` tags the observations and
    names the source in error/partial messages (the collect.py source key)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    wanted = set(area_fips)
    out: list[Observation] = []
    loaded, errors = 0, []
    for year, q in _recent_quarters(vintage):
        try:
            resp = http_get(QCEW_URL.format(year=year, qtr=q, naics=naics),
                            timeout=120)  # industry files are large (all counties)
            resp.raise_for_status()
            rows = _parse_quarter(resp.text, wanted, vintage, naics, source)
        except Exception as e:  # per-quarter: never discard the other quarters
            errors.append((f"{year}q{q}", e))
            continue
        loaded += 1
        out.extend(rows)
    if not loaded:
        raise RuntimeError(f"{source}: no quarter loaded — " + "; ".join(
            f"{q}: {type(e).__name__}" for q, e in errors))
    warn_partial(source, errors)
    return out
