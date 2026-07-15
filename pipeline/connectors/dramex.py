"""DRAMeXchange DRAM/NAND spot prices — scraped from https://www.dramexchange.com/

One observation per series per run: the session average from the public spot
table (the closing session, ~18:10 GMT+8, precedes the 8:40 ET run). The page
shows the current session only — no history exists to backfill, which is why
collection ships ahead of any consuming feature (wave-3a collectors-first).
Scrape protections per house convention: per-row regex anchored on the exact
product label, pinned to tests/fixtures/dramex.html; plausible-range check;
collect-layer isolation.

ToS posture (spike 2026-07-15, corrected): §6.2 requires express prior
written consent for publication/redistribution; §6.3 alone is not an
attribution license. This wave COLLECTS for internal analysis only;
publication of any DRAM-derived value is gated on a wave-3b ToS resolution
(see docs/superpowers/specs/2026-07-15-collectors-first-design.md §3.1).
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://www.dramexchange.com/"
PLAUSIBLE = (0.5, 1000.0)   # $ per unit — outside this the table has drifted
AVG_CELL = 5                # SPIKE-FINAL: session average is the Nth gray cell
_CELL = r'.*?tab_tr_gray">([0-9.]+)<'


def _row_re(label: str) -> re.Pattern:
    # Anchored on the exact product label; captures AVG_CELL numeric cells.
    # DOTALL + non-greedy could in principle leak past a short row into its
    # neighbor — the fixture pin plus the range check catch that drift.
    return re.compile(re.escape(label) + _CELL * AVG_CELL, re.DOTALL)


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = the exact product-row label (spike-pinned)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    out = []
    for sid in source_ids:
        m = _row_re(sid).search(html)
        if not m:
            raise ValueError(
                f"DRAMeXchange row {sid!r} not found (structure drift?)")
        value = float(m.group(AVG_CELL))
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            raise ValueError(f"DRAMeXchange {sid}: {value} implausible "
                             f"(range {PLAUSIBLE}) — structure drift?")
        out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                               vintage_date=vintage, source="DRAMEX",
                               route="SCRAPE"))
    return out
