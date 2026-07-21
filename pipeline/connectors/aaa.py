"""AAA national average gas price — scraped from https://gasprices.aaa.com/

One observation per run (today's national regular average); daily history
accrues in the store. Scrape protections (spec 2a §3): tight regex pinned to
a recorded fixture, plausible-range check, and the collect-layer isolation —
a redesigned page degrades fuel to its blend partners, never crashes the run.

Access spike (2026-07-09): the live page repeats the national average in two
places — a mobile banner ("Today’s AAA National Average $3.8460") and a
desktop badge that splits the same label across a <br/> ("Today’s AAA<br/>
National Average" ... "$3.8460" in a following <p class="numb">). The mobile
banner's text is contiguous, so anchoring on that exact label is a tight,
single-match anchor — it does NOT match the desktop badge (split by the
<br/>) or the per-grade "Current Avg." table row (no label at all), even
though both contain the same numeric value. The price itself is always
$D.DDDD (single dollar digit, 4 decimals) across the whole page, confirmed
across every grade/state price sampled in the spike fixture.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text, warn_partial
from pipeline.models import Observation

URL = "https://gasprices.aaa.com/"
STATE_URL = "https://gasprices.aaa.com/state-gas-price-averages/"
# Pinned by the Task-7 spike against tests/fixtures/aaa.html — the national
# average appears as "AAA National Average $D.DDDD" in the mobile-banner
# price-text block (see module docstring).
PRICE_RE = re.compile(r"AAA National Average\s+\$(\d\.\d{4})")
PLAUSIBLE = (1.5, 7.0)  # $/gal — outside this the page structure has drifted
# Pinned by the P2 T4 recording against tests/fixtures/aaa_states.html — each
# state row is an anchor td (abbrev in the href, full name in the text, both
# spread across lines) followed by the regular-grade td, which carries a style
# attribute and trailing whitespace before its price.
STATE_ROW_RE = re.compile(
    r'<a href="https://gasprices\.aaa\.com\?state=([A-Z]{2})">\s*'
    r'[A-Za-z .]+?\s*</a>\s*</td>\s*'
    r'<td class="regular"[^>]*>\$(\d\.\d{4})')
STATE_COUNT = 51  # 50 states + DC
MAX_IMPLAUSIBLE_STATES = 3  # more than this outside PLAUSIBLE = structure drift


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    m = PRICE_RE.search(html)
    if not m:
        raise ValueError("AAA page: national average not found (structure drift?)")
    value = float(m.group(1))
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"AAA national average {value} implausible "
                         f"(range {PLAUSIBLE}) — structure drift?")
    return [Observation(series_code="aaa_gas_d", obs_date=vintage, value=value,
                        vintage_date=vintage, source="AAA", route="SCRAPE")]


def fetch_states(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """51-state regular-grade averages off the dedicated state-averages page.

    Parsing is sliced to the <table id="sortable"> extent first so the national
    banner elsewhere on the page can never cross-match. Emits series_code = the
    lowercased 2-letter abbrev from the row's href (the registry source_id);
    collect's id_map remaps to the internal aaa_gas_{st} codes.
    """
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(STATE_URL, http_get)
    start = html.find('<table id="sortable"')
    if start == -1:
        raise ValueError("AAA state page: sortable table not found (structure drift?)")
    end = html.find("</table>", start)
    if end == -1:
        raise ValueError("AAA state page: sortable table unterminated (structure drift?)")
    rows = STATE_ROW_RE.findall(html[start:end])
    if len(rows) != STATE_COUNT:
        raise ValueError(f"AAA state page: parsed {len(rows)} state rows, "
                         f"expected {STATE_COUNT} (structure drift?)")
    out, implausible = [], []
    for abbrev, price in rows:
        value = float(price)
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            implausible.append(f"{abbrev}={value}")
            continue
        out.append(Observation(series_code=abbrev.lower(), obs_date=vintage,
                               value=value, vintage_date=vintage,
                               source="AAA_STATE", route="SCRAPE"))
    # A lone outlier is a price extreme or one bad cell — drop it and let
    # carry-forward cover the day. Widespread outliers mean the table drifted.
    if len(implausible) > MAX_IMPLAUSIBLE_STATES:
        raise ValueError(f"AAA state page: {len(implausible)} prices implausible "
                         f"(range {PLAUSIBLE}): {', '.join(implausible)} — "
                         f"structure drift?")
    warn_partial("AAA_STATE",
                 [(s, ValueError(f"implausible (range {PLAUSIBLE})"))
                  for s in implausible])
    return out
