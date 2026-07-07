"""Freddie Mac PMMS weekly mortgage survey — history CSV.

Weekly 30yr fixed average. Primary daily-rate source (MND scrape) arrives in
Phase 2; PMMS is the durable fallback per spec §5.
"""
import csv
import io
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

PMMS_URL = "https://www.freddiemac.com/pmms/docs/PMMS_history.csv"
START = "2017-01-01"


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    reader = csv.DictReader(io.StringIO(get_text(PMMS_URL, http_get)))
    for row in reader:
        rate = (row.get("pmms30") or "").strip()
        if not rate:
            continue
        obs_date = datetime.strptime(row["date"].strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
        if obs_date < START:
            continue
        out.append(Observation(series_code="pmms_30yr", obs_date=obs_date,
                               value=float(rate), vintage_date=vintage,
                               source="PMMS", route="CSV"))
    return out
