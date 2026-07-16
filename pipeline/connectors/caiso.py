"""CAISO OASIS day-ahead LMP — SP15 trading hub, daily average.

Keyless public market data (FERC transparency). One SingleZip request per
run: a zip-of-CSV of hourly DAM LMPs for one trade date, averaged into a
single $/MWh observation. Negative daily means are real (curtailment); DST
days have 23/25 hourly rows. OASIS throttles aggressive clients — the daily
run makes exactly one request; the backfill script sleeps between windows.

SPIKE-FINAL (docs/superpowers/specs/2026-07-15-power-spike-notes.md §1): the
`T07:00-0000`..`T07:00-0000` window boundary only aligns to exactly one trade
date during Pacific Daylight Time. In PST months it leaks a handful of the
prior day's HE24 rows into the response. Rather than compute a DST-aware GMT
offset, the connector filters unzipped rows by the CSV's own `OPR_DT` column
against the requested trade date — simpler and robust year-round.
"""
import csv
import io
import zipfile

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_bytes
from pipeline.models import Observation

URL = ("https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP"
       "&startdatetime={d}T07:00-0000&enddatetime={e}T07:00-0000"
       "&version=1&market_run_id=DAM&node={node}&resultformat=6")
OPR_DT_COL = "OPR_DT"                                    # SPIKE-FINAL
LMP_TYPE_COL, LMP_TYPE_VAL, PRICE_COL = "LMP_TYPE", "LMP", "MW"
PLAUSIBLE = (-100.0, 3000.0)   # $/MWh daily mean; negatives are real
ROW_RANGE = (20, 28)           # hourly rows incl. DST 23/25


def _next_day(d: str) -> str:
    from datetime import date, timedelta
    return (date.fromisoformat(d) + timedelta(days=1)).isoformat()


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None, trade_date: str | None = None) -> list[Observation]:
    """source_id = OASIS node id. trade_date defaults to today (DAM for
    today publishes the prior afternoon)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    day = trade_date or vintage
    out = []
    for node in source_ids:
        raw = get_bytes(URL.format(d=day.replace("-", ""),
                                   e=_next_day(day).replace("-", ""),
                                   node=node), http_get)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".csv")]
            if not names:
                raise ValueError(f"caiso {node}: zip has no CSV (structure drift?)")
            text = z.read(names[0]).decode("utf-8", "replace")
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = reader.fieldnames or []
        if (OPR_DT_COL not in fieldnames or LMP_TYPE_COL not in fieldnames
                or PRICE_COL not in fieldnames):
            raise ValueError(f"caiso {node}: columns {fieldnames} lack "
                             f"{OPR_DT_COL}/{LMP_TYPE_COL}/{PRICE_COL} "
                             "(structure drift?)")
        # SPIKE-FINAL: filter by OPR_DT == trade date as well as LMP_TYPE —
        # the T07:00 window alone leaks neighbor-day rows in PST months.
        prices = [float(r[PRICE_COL]) for r in reader
                  if r.get(OPR_DT_COL) == day
                  and r.get(LMP_TYPE_COL) == LMP_TYPE_VAL]
        if not ROW_RANGE[0] <= len(prices) <= ROW_RANGE[1]:
            raise ValueError(f"caiso {node}: {len(prices)} hourly rows outside "
                             f"{ROW_RANGE} (structure drift?)")
        value = round(sum(prices) / len(prices), 4)
        if not PLAUSIBLE[0] <= value <= PLAUSIBLE[1]:
            raise ValueError(f"caiso {node}: mean {value} outside {PLAUSIBLE} "
                             "— structure drift?")
        out.append(Observation(series_code=node, obs_date=day, value=value,
                               vintage_date=vintage, source="CAISO", route="API"))
    return out
