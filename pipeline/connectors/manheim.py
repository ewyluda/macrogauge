"""Manheim Used Vehicle Value Index — monthly publish page scrape.

Wholesale leads retail: the engine reads this series shifted +30 days
(config/basket.json used_vehicles.lead_days), per spec §5. One observation
per run — the latest published report (Cox Automotive updates the page
mid-month, then again with the full-month figure); monthly cadence accepted.

Access spike (2026-07-09): publish.manheim.com/en/services/consulting/
used-vehicle-value-index.html 301-redirects to site.manheim.com (same path);
fetch the destination directly. The live page carries exactly one dated
report section — a heading "Manheim Used Vehicle Value Index: Mid-<Month>
<Year> Trends" (the "Mid-" prefix drops for the full-month update later in
the month), followed a few hundred characters later by prose stating
"(MUVVI) increased/decreased to <value>". The same value is repeated
verbatim in a standalone stat callout further down the same section — a
second-match trap for a regex not anchored to the dated heading. A second,
unrelated trap: the page's closing paragraph always names the *next*
release date (e.g. "released on Jan. 8, 2026"), a different month/year than
the report the page is currently displaying — a bare month-name/year scan
over the whole page would latch onto that instead. Anchoring on the unique
"... Trends" heading and reading forward (DOTALL, lazy) to the first
"(MUVVI) <verb> to" clause avoids both traps. Recorded at spike time: value
206.0, reference month December 2025 (mid-month report) — pinned into
tests/fixtures/manheim.html and tests/test_manheim.py."""
import re
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://site.manheim.com/en/services/consulting/used-vehicle-value-index.html"
# Pinned by the Task-9 spike against tests/fixtures/manheim.html — see module
# docstring for why this anchor (the dated "... Trends" heading, not the
# repeated stat callout or the unrelated next-release date) is tight.
INDEX_RE = re.compile(
    r"Used Vehicle Value Index:\s*(?:Mid-)?(\w+)\s+(\d{4})\s+Trends"
    r".*?\(MUVVI\)\s+(?:increased|decreased|rose|fell|climbed)\s+to\s+(\d{3}\.\d)",
    re.DOTALL,
)
PLAUSIBLE = (100.0, 350.0)  # index points (base Jan 1997 = 100) — outside this, structure drift


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    m = INDEX_RE.search(html)
    if not m:
        raise ValueError("Manheim page: UVVI value not found (structure drift?)")
    month_name, year, value_str = m.group(1), m.group(2), m.group(3)
    value = float(value_str)
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"Manheim UVVI {value} implausible (range {PLAUSIBLE}) — "
                         f"structure drift?")
    month = datetime.strptime(f"{month_name} {year}", "%B %Y")
    return [Observation(series_code="manheim_uvvi_m",
                        obs_date=month.strftime("%Y-%m-01"), value=value,
                        vintage_date=vintage, source="MANHEIM", route="SCRAPE")]
