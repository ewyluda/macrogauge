"""DRAMeXchange DRAM/NAND spot prices — scraped from https://www.dramexchange.com/

One observation per series per run: the session average from the public spot
table (the closing session, ~18:10 GMT+8, precedes the 8:40 ET run). The page
shows the current session only; history before live collection (2026-07-15)
comes from Wayback Machine snapshots of this same page
(scripts/backfill_dramex_wayback.py, route WAYBACK, 2019-02 on).
Scrape protections per house convention: per-row regex anchored on the exact
product label, pinned to tests/fixtures/dramex.html; plausible-range check;
collect-layer isolation.

ToS posture (spike 2026-07-15, corrected): §6.2 requires express prior
written consent for publication/redistribution; §6.3 alone is not an
attribution license. This wave COLLECTS for internal analysis only;
publication of any DRAM-derived value is gated on a wave-3b ToS resolution
(see docs/superpowers/specs/2026-07-15-collectors-first-design.md §3.1).
Resolved 2026-10-02 by the owner: MacroGauge is educational and not resold,
so NAND-derived values (the gated storage tail) and the archived history may
be published and committed.
"""
import re
from datetime import date

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://www.dramexchange.com/"
PLAUSIBLE = (0.5, 1000.0)   # $ per unit — outside this the table has drifted
AVG_CELL = 5                # SPIKE-FINAL: session average is the Nth gray cell
_CELL = r'(?:(?!</tr>).)*?tab_tr_gray">([0-9.]+)<'


def _row_re(label: str) -> re.Pattern:
    # Anchored on the exact product label; captures AVG_CELL numeric cells.
    # Each cell-scan is a tempered dot bounded by </tr>, so a short row (e.g.
    # a blanked session-average cell) raises structure drift instead of
    # bleeding a neighbor row's plausible values into the capture — the
    # row-leak demonstrated in the collectors spike (wave-3b hardening).
    return re.compile(re.escape(label) + _CELL * AVG_CELL, re.DOTALL)


_STAMP = r'Last Update:\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})\s+(\d{4})'
_FLASH_STAMP = re.compile(
    r'id="NationalFlashSpotPrice_show_day".*?' + _STAMP, re.DOTALL)
_TABLE = re.compile(r'id="National\w+SpotPrice_show_day"')
_MONTHS = {m: i + 1 for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}


def flash_last_update(html: str) -> str | None:
    """The flash table's own "Last Update" date (YYYY-MM-DD), or None when
    the stamp is missing. The flash table can lag the DRAM one by days (the
    fixture: flash Jul.6, DRAM Jul.15), so a backfilled snapshot is dated by
    this stamp, not by when it was archived (scripts/backfill_dramex_wayback.py)."""
    return _stamp_date(_FLASH_STAMP.search(html))


def _stamp_date(m: re.Match | None) -> str | None:
    if not m or m.group(1).lower() not in _MONTHS:
        return None
    return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()


def table_last_update(html: str, pos: int) -> str | None:
    """The "Last Update" stamp of the spot table holding the row at `pos`:
    the nearest table anchor before it, then its first stamp. None when
    either is missing."""
    anchors = [a.end() for a in _TABLE.finditer(html, 0, pos)]
    if not anchors:
        return None
    return _stamp_date(re.compile(_STAMP).search(html, anchors[-1], pos))


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
        # Date the row by its own table's stamp, not the run: the flash table
        # can sit unchanged for a week or more (live 2026-10-02: stamped
        # Sep.21 while every run since had stored 40.75 as a fresh daily
        # print), and a run-dated row turns one stale reading into a run of
        # fake daily observations that hide the staleness from freshness QA.
        # Clamped to the run date; the run date is the fallback when the
        # stamp is missing.
        stamp = table_last_update(html, m.start())
        obs_date = min(stamp, vintage) if stamp else vintage
        out.append(Observation(series_code=sid, obs_date=obs_date, value=value,
                               vintage_date=vintage, source="DRAMEX",
                               route="SCRAPE"))
    return out
