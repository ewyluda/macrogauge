"""Zillow research CSVs — https://www.zillow.com/research/data/

National and metro ZORI (rent index) and ZHVI (home value index). The files
are wide: one row per region, one column per month-end date. source_id
grammar: "zori"/"zhvi" is the United States row (RegionID 102001);
"zori:394913"/"zhvi:394913" is a metro by RegionID. Each CSV is parsed once,
keeping the US row plus every requested RegionID; the emitted series_code is
the source_id string (collect's id_map remaps to internal codes). URLs move
occasionally — they live in constants so the fix is a one-liner (the QA
connector check catches the breakage).
"""
import csv
import io

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text, month_first
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
            metros_found += 1
            out.extend(_row_obs(row, f"{prefix}:{row['RegionID']}", vintage))
    if want_us and not us_found:
        raise ValueError(f"United States row not found for {prefix}")
    if metro_ids and metros_found == 0:
        # A single registered RegionID absent from the file is tolerated
        # (metros come and go), but every requested metro vanishing at once
        # means the file changed shape, not that 50 msas were delisted.
        raise ValueError(f"no requested metro rows found for {prefix} "
                         "— structure drift?")
    return out


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    for prefix, url in (("zori", ZORI_URL), ("zhvi", ZHVI_URL)):
        wanted = [sid for sid in source_ids
                  if sid == prefix or sid.startswith(prefix + ":")]
        if wanted:
            out.extend(_file_series(get_text(url, http_get), prefix,
                                    wanted, vintage))
    return out
