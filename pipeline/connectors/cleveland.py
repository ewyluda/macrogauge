"""Cleveland Fed inflation-nowcast benchmark scraper.

Drift protection (spec 2a §3, same convention as aaa/mnd/manheim): regex
pinned to tests/fixtures/cleveland.html (recorded 2026-07-11) plus a
plausible-range check — the year-over-year table sits directly below the
month-over-month table on the same page, so an anchor that slides grabs
YoY-magnitude values (~2–3) that a MoM bound must reject.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting"
PLAUSIBLE = (-2.0, 2.0)  # MoM %: postwar extremes are within ~±1.9


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    text = re.sub(r"<[^>]+>", " ", get_text(URL, http_get))
    text = re.sub(r"\s+", " ", text)
    # First monthly row is the nearest target. Four values are CPI, core CPI,
    # PCE and core PCE, followed by MM/DD updated date.
    match = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+"
        r"(20\d{2})\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+"
        r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+\d{1,2}/\d{1,2}", text)
    if not match:
        raise ValueError("Cleveland nowcast table structure drift?")
    month_num = ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"].index(match[1]) + 1
    obs_date = f"{match[2]}-{month_num:02d}-01"
    values = (("cleveland_cpi_mom", match[3]), ("cleveland_core_cpi_mom", match[4]),
              ("cleveland_pce_mom", match[5]), ("cleveland_core_pce_mom", match[6]))
    for code, value in values:
        if not (PLAUSIBLE[0] <= float(value) <= PLAUSIBLE[1]):
            raise ValueError(f"Cleveland {code} = {value} implausible for MoM "
                             f"(range {PLAUSIBLE}) — structure drift?")
    return [Observation(code, obs_date, float(value), vintage, "CLEVELAND", "SCRAPE")
            for code, value in values]
