"""Apartment List rent estimates — https://www.apartmentlist.com/research/category/data-rent-estimates

Monthly national rent estimate, wide CSV (one row per location x bed_size, one
column per month). Second leg of the shelter blend (basket.json aptlist_us:
0.3). Verified live 2026-07-09: the national row has location_name="United
States", location_type="National", and repeats per bed_size ("overall", "1br",
"2br") — we want the "overall" row, not "location_name == National" (that
value doesn't appear; it's the location_type instead). URL lives in a
constant — moves (the asset id/hash changes on every monthly refresh) are a
one-line fix, caught by the QA connector check."""
import csv
import io

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text, month_first
from pipeline.models import Observation

# Pinned by the Task-4 access spike (2026-07-09) — "Historic Rent Estimates
# (Jan 2017 - Present)" download on the research/category/data-rent-estimates
# page. The Contentful asset id/hash and the trailing YYYY_MM in the filename
# change on every monthly refresh, so this URL needs periodic upkeep.
CSV_URL = ("https://assets.ctfassets.net/jeox55pd4d8n/1KG2u9qAn6YlTDnQA1q6Jd/"
           "dcdd8e50defdf26e6b84e0dab33284c3/Apartment_List_Rent_Estimates_2026_06.csv")
START = "2017-01-01"


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    reader = csv.DictReader(io.StringIO(get_text(CSV_URL, http_get)))
    for row in reader:
        if row.get("location_name") != "United States" or row.get("bed_size") != "overall":
            continue
        out = []
        for col, val in row.items():
            # month columns per the spike, e.g. "2017_01" -> "2017-01-01"
            if len(col) == 7 and col[4] == "_" and val not in (None, ""):
                obs_date = month_first(col.replace("_", "-"))
                if obs_date >= START:
                    out.append(Observation(series_code="aptlist_us",
                                           obs_date=obs_date, value=float(val),
                                           vintage_date=vintage,
                                           source="APTLIST", route="CSV"))
        return sorted(out, key=lambda o: o.obs_date)
    raise ValueError("National row not found in Apartment List CSV")
