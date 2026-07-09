"""Mortgage News Daily 30yr fixed — daily rate scrape.

Primary rate input for the Cost-of-Living variant's marginal-buyer payment
(spec §5 variant table); PMMS weekly is the durable fallback. One observation
per run; daily history accrues.

Access spike (2026-07-09): the 30-year-fixed page repeats 6.65% in several
places (header ticker, sidebar widget, and a three-way history table), plus
carries several *other* rates that are decoys for a naive scrape — the 15YR
ticker price, the same table row's "Prior Year" column, and the MBA/Freddie
Mac weekly rows further down the same table. The one stable, unambiguous
anchor is the table itself: it groups rows under a `<th class="rate-product">`
header per survey, and MND's own daily survey is uniquely labeled "MND's 30
Year Fixed (daily survey)" — no other section shares that text. Anchoring
there and taking the first `<td class="rate">` that follows (lazy match,
still inside the row's date/rate-date cell first) lands on the Rate column of
today's row, never the Prior Year column (a second `class="rate"` cell in the
same row) nor the MBA/Freddie Mac weekly sections below it.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://www.mortgagenewsdaily.com/mortgage-rates/30-year-fixed"
# Pinned by the Task-8 spike against tests/fixtures/mnd.html — see module
# docstring for why this anchor (not the header ticker or sidebar widget,
# both of which repeat the same value but aren't uniquely labeled) is tight.
RATE_RE = re.compile(
    r"MND's 30 Year Fixed \(daily survey\).*?<td class=\"rate\">(\d{1,2}\.\d{2})%</td>",
    re.DOTALL,
)
PLAUSIBLE = (2.0, 12.0)  # percent


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    m = RATE_RE.search(html)
    if not m:
        raise ValueError("MND page: 30yr rate not found (structure drift?)")
    value = float(m.group(1))
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"MND 30yr rate {value} implausible (range {PLAUSIBLE}) — "
                         f"structure drift?")
    return [Observation(series_code="mnd_30y_d", obs_date=vintage, value=value,
                        vintage_date=vintage, source="MND", route="SCRAPE")]
