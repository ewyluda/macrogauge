"""Cleveland Fed inflation-nowcast benchmark scraper."""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting"


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    response = http_get(URL, timeout=30)
    response.raise_for_status()
    text = re.sub(r"<[^>]+>", " ", response.text)
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
    return [Observation(code, obs_date, float(value), vintage, "CLEVELAND", "SCRAPE")
            for code, value in values]
