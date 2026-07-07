"""Zillow research CSVs — https://www.zillow.com/research/data/

National ZORI (rent index) and ZHVI (home value index). The files are wide:
one row per region, one column per month-end date. We keep only the
United States row. URLs move occasionally — they live in constants so the
fix is a one-liner (the QA connector check catches the breakage).
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


def _us_series(csv_text: str, code: str, vintage: str) -> list[Observation]:
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        if row["RegionName"] != "United States":
            continue
        out = []
        for col, val in row.items():
            if len(col) == 10 and col[4] == "-" and val not in (None, ""):
                obs_date = month_first(col)
                if obs_date >= START:
                    out.append(Observation(series_code=code, obs_date=obs_date,
                                           value=float(val), vintage_date=vintage,
                                           source="ZILLOW", route="CSV"))
        return out
    raise ValueError(f"United States row not found for {code}")


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    return (_us_series(get_text(ZORI_URL, http_get), "zori_us", vintage)
            + _us_series(get_text(ZHVI_URL, http_get), "zhvi_us", vintage))
