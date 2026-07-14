"""Cleveland Fed inflation-nowcast benchmark scraper.

Drift protection (spec 2a §3, same convention as aaa/mnd/manheim): regex
pinned to tests/fixtures/cleveland.html (recorded 2026-07-13, full page)
plus a plausible-range check. The year-over-year table sits directly below
the month-over-month table and matches the same row shape, so rows are only
read between the two table headings — every month row there must publish:
the page carries the next month AND the current reference month until its
print lands, and dropping the latter empties the benchmark out of the
ensemble in the week before every release.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting"
PLAUSIBLE = (-2.0, 2.0)  # MoM %: postwar extremes are within ~±1.9
MOM_HEADING = "month-over-month percent change"
YOY_HEADING = "year-over-year percent change"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
# Month, year, then CPI / core CPI / PCE / core PCE, then MM/DD updated date.
ROW = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+"
    r"(20\d{2})\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+"
    r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+\d{1,2}/\d{1,2}")


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    text = re.sub(r"<[^>]+>", " ", get_text(URL, http_get))
    text = re.sub(r"\s+", " ", text)
    start = text.find(MOM_HEADING)
    if start < 0:
        raise ValueError("Cleveland nowcast table structure drift? "
                         "(month-over-month heading missing)")
    end = text.find(YOY_HEADING, start)
    matches = list(ROW.finditer(text, start, end if end >= 0 else len(text)))
    if not matches:
        raise ValueError("Cleveland nowcast table structure drift?")
    out: list[Observation] = []
    for match in matches:
        obs_date = f"{match[2]}-{MONTHS.index(match[1]) + 1:02d}-01"
        values = (("cleveland_cpi_mom", match[3]), ("cleveland_core_cpi_mom", match[4]),
                  ("cleveland_pce_mom", match[5]), ("cleveland_core_pce_mom", match[6]))
        for code, value in values:
            if not (PLAUSIBLE[0] <= float(value) <= PLAUSIBLE[1]):
                raise ValueError(f"Cleveland {code} = {value} implausible for MoM "
                                 f"(range {PLAUSIBLE}) — structure drift?")
        out.extend(Observation(code, obs_date, float(value), vintage,
                               "CLEVELAND", "SCRAPE")
                   for code, value in values)
    return out
