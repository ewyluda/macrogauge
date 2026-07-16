"""MISO day-ahead ex-post LMP — Indiana Hub, daily average.

Keyless public market report (one CSV per market day, posted the evening
before). MISO's day-ahead market runs every day, weekends included — there
is no weekend/holiday gap in this file. Wide format: preamble lines, then
node rows x HE1-HE24 (separate LMP/MCC/MLC rows per node — only the LMP row
is used). A 404 for the requested date means the file is beyond the
~1-day publish horizon, never a market-calendar gap — treated as a skip,
never an error; retention is ~3.5 years, so a miss beyond that window is
unrecoverable here (carry-forward makes a single missed day harmless).

SPIKE-FINAL (docs/superpowers/specs/2026-07-15-power-spike-notes.md §2):
- Preamble is 4 lines + 1 column-header line = 5 lines before the first data
  row (corrects an earlier "2 header lines" assumption).
- Hub label is the exact string `INDIANA.HUB` (column 1, "Node").
- The LMP/MCC/MLC discriminator is the THIRD column, whose header is
  confusingly named `Value` (not `Type` — column 2, "Type", is the
  unrelated node category "Hub"). Resolved by header name, never by
  position, since the header row is always present.
- HE column count is a fixed 24 (`HE 1`..`HE 24`) year-round, including on
  DST-transition days — MISO's CSV schema does not shrink/grow with the
  real-world wall-clock day.
- Fetched with a browser User-Agent for reliability against the Azure blob
  storage backend (not re-tested bare).
"""
import csv
from datetime import date, timedelta

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://docs.misoenergy.org/marketreports/{d}_da_expost_lmp.csv"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

PREAMBLE_LINES = 4                                       # SPIKE-FINAL
NODE_COL, ROWTYPE_COL, ROWTYPE_LMP = "Node", "Value", "LMP"   # SPIKE-FINAL
PLAUSIBLE = (-100.0, 3000.0)   # $/MWh daily mean; negatives are real
ROW_RANGE = (20, 28)           # HE columns, incl. DST slop


def _default_get(url, timeout=60):
    return requests.get(url, timeout=timeout, headers={"User-Agent": _UA})


def _yesterday_et() -> str:
    return (date.fromisoformat(today_et()) - timedelta(days=1)).isoformat()


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None, market_date: str | None = None) -> list[Observation]:
    """source_id = the exact hub label in the Node column (e.g. INDIANA.HUB).

    market_date defaults to yesterday-ET: today's file is posted the evening
    before, so yesterday's is the most recent date reliably available at an
    8:40am ET run."""
    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    day = market_date or _yesterday_et()
    url = URL.format(d=day.replace("-", ""))

    resp = http_get(url, timeout=60)
    if getattr(resp, "status_code", 200) == 404:
        return []
    resp.raise_for_status()

    lines = resp.text.splitlines()
    if len(lines) <= PREAMBLE_LINES:
        raise ValueError("miso: response shorter than the expected preamble "
                         "(structure drift?)")
    reader = csv.DictReader(lines[PREAMBLE_LINES:])
    fieldnames = reader.fieldnames or []
    if NODE_COL not in fieldnames or ROWTYPE_COL not in fieldnames:
        raise ValueError(f"miso: columns {fieldnames} lack "
                         f"{NODE_COL}/{ROWTYPE_COL} (structure drift?)")
    he_cols = [c for c in fieldnames if c.startswith("HE ")]
    if not he_cols:
        raise ValueError(f"miso: no HE columns in {fieldnames} "
                         "(structure drift?)")
    rows = list(reader)

    out = []
    for hub in source_ids:
        match = next((r for r in rows if r.get(NODE_COL) == hub
                     and r.get(ROWTYPE_COL) == ROWTYPE_LMP), None)
        if match is None:
            raise ValueError(f"miso {hub}: LMP row not found "
                             "(structure drift?)")

        values = []
        for col in he_cols:
            raw = (match.get(col) or "").strip()
            try:
                values.append(float(raw))
            except ValueError:
                raise ValueError(f"miso {hub}: malformed {col} cell "
                                 f"{raw!r} (structure drift?)") from None

        if not ROW_RANGE[0] <= len(values) <= ROW_RANGE[1]:
            raise ValueError(f"miso {hub}: {len(values)} HE columns outside "
                             f"{ROW_RANGE} (structure drift?)")

        mean = round(sum(values) / len(values), 2)
        if not PLAUSIBLE[0] <= mean <= PLAUSIBLE[1]:
            raise ValueError(f"miso {hub}: mean {mean} outside {PLAUSIBLE} "
                             "— structure drift?")

        out.append(Observation(series_code=hub, obs_date=day, value=mean,
                               vintage_date=vintage, source="MISO",
                               route="CSV"))
    return out
