"""sfcompute H100/H200/B200 spot averages — scraped from the homepage's
Next.js flight payload.

The payload embeds pricesByHardwareType with ~31 trailing daily rows per
hardware type, so each fetch emits a month of observations: a missed run
self-heals from the next day's overlap, and vintage.append's value-dedupe
keeps re-fetched days free — unique among our scrapes. Regex pinned to
tests/fixtures/sfcompute.html; plausible-range check; collect isolation.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://sfcompute.com"
PLAUSIBLE = (0.2, 50.0)   # $/GPU-hr
# SPIKE-FINAL escaping: Next.js flight payload escapes quotes; dates carry a
# $D prefix. Pinned against the recorded fixture.
ROW_RE = re.compile(
    r'\\"date\\":\\"(?:\$D)?(\d{4}-\d{2}-\d{2})[^"\\]*\\",\\"avg\\":([0-9.]+)')


def _section(html: str, key: str) -> str:
    m = re.search(r'\\"' + re.escape(key) + r'\\":\[(.*?)\]', html, re.DOTALL)
    if not m:
        raise ValueError(
            f"sfcompute section {key!r} not found (structure drift?)")
    return m.group(1)


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = the pricesByHardwareType key (H100 / H200 / B200)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    out = []
    for sid in source_ids:
        rows = ROW_RE.findall(_section(html, sid))
        if not rows:
            raise ValueError(
                f"sfcompute {sid}: zero rows parsed (structure drift?)")
        for date_s, avg_s in rows:
            value = float(avg_s)
            if value == 0:
                continue  # avg 0 = no trades that day (spike-observed for
                          # H200/B200), a real market state — never an error
            if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
                raise ValueError(f"sfcompute {sid}: {value} implausible "
                                 f"(range {PLAUSIBLE}) — structure drift?")
            out.append(Observation(series_code=sid, obs_date=date_s,
                                   value=value, vintage_date=vintage,
                                   source="SFCOMPUTE", route="SCRAPE"))
    return out
