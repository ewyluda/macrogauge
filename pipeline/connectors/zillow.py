"""Zillow research CSVs — https://www.zillow.com/research/data/

National and metro ZORI (rent index) and ZHVI (home value index). The files
are wide: one row per region, one column per month-end date. source_id
grammar: "zori"/"zhvi" is the United States row (RegionID 102001);
"zori:394913"/"zhvi:394913" is a metro by RegionID. Each CSV is parsed once,
keeping the US row plus every requested RegionID; the emitted series_code is
the source_id string (collect's id_map remaps to internal codes). URLs move
occasionally — they live in constants so the fix is a one-liner (the QA
connector check catches the breakage).

Two reliability tiers, isolated so the speculative one can't take down the
core one (same convention as fred per-series / qcew per-quarter): the US row
is the anchor — a missing US row raises (real shape drift) — while the metros
are a speculative tier whose absence is tolerated and surfaces via the
per-series staleness QA, never by discarding the US row. fetch() parses each
file (zori, zhvi) under its own isolation, so a drift in one never skips the
other; zero files loaded raises so a total breakage still surfaces.
"""
import csv
import io

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text, month_first, warn_partial
from pipeline.models import Observation

ZORI_URL = ("https://files.zillowstatic.com/research/public_csvs/zori/"
            "Metro_zori_uc_sfrcondomfr_sm_month.csv")
ZHVI_URL = ("https://files.zillowstatic.com/research/public_csvs/zhvi/"
            "Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv")
START = "2017-01-01"


def _row_obs(row: dict, code: str, vintage: str) -> list[Observation]:
    out = []
    for col, val in row.items():
        if len(col) == 10 and col[4] == "-" and val not in (None, ""):
            obs_date = month_first(col)
            if obs_date >= START:
                out.append(Observation(series_code=code, obs_date=obs_date,
                                       value=float(val), vintage_date=vintage,
                                       source="ZILLOW", route="CSV"))
    return out


def _file_series(csv_text: str, prefix: str, wanted: list[str],
                 vintage: str) -> list[Observation]:
    want_us = prefix in wanted
    metro_ids = {sid.split(":", 1)[1] for sid in wanted if ":" in sid}
    out: list[Observation] = []
    us_found, metros_found = False, 0
    for row in csv.DictReader(io.StringIO(csv_text)):
        if row["RegionName"] == "United States":
            us_found = True
            if want_us:
                out.extend(_row_obs(row, prefix, vintage))
        elif row["RegionType"] == "msa" and row["RegionID"] in metro_ids:
            try:  # per-row: a garbage metro cell must not discard the US row
                rows = _row_obs(row, f"{prefix}:{row['RegionID']}", vintage)
            except (TypeError, ValueError):
                continue
            metros_found += 1
            out.extend(rows)
    if want_us and not us_found:
        # The US row is the anchor: its absence is a real shape drift. Metros
        # are the speculative tier — every requested metro vanishing at once
        # is tolerated (surfaces as 50 stale series in the freshness QA), never
        # discarding the parsed US row along with it.
        raise ValueError(f"United States row not found for {prefix}")
    return out


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """Per-file isolation: a drift in the ZORI file must not skip the ZHVI
    fetch, and a parsed US row must survive a metros-only anomaly. Zero files
    loaded raises (total breakage surfaces via collect's isolation); a sole
    failing file re-raises its original error so the drift message stays
    greppable in sources_status."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    errors: list[tuple[str, Exception]] = []
    loaded = 0
    for prefix, url in (("zori", ZORI_URL), ("zhvi", ZHVI_URL)):
        wanted = [sid for sid in source_ids
                  if sid == prefix or sid.startswith(prefix + ":")]
        if not wanted:
            continue
        try:
            rows = _file_series(get_text(url, http_get), prefix, wanted, vintage)
        except Exception as e:  # per-file: one file's drift must not skip the other
            errors.append((prefix, e))
            continue
        loaded += 1
        out.extend(rows)
    if not loaded and errors:
        if len(errors) == 1:  # nothing was isolated — surface the real exception
            raise errors[0][1]
        raise RuntimeError("ZILLOW: no file loaded — " + "; ".join(
            f"{p}: {type(e).__name__}" for p, e in errors))
    warn_partial("ZILLOW", errors)
    return out
