"""NYISO day-ahead zonal LBMP — daily average per zone.

Keyless public CSV, one file per delivery day (mis.nyiso.com), 15 zones x 24
hour-beginning rows in Eastern prevailing time. Tomorrow's file posts ~09:30
ET; a not-yet-posted OR aged-out day returns 404 (daily files are kept only
~10 days), so both are skips and the catch-up window stays well inside that
retention. Backfill reads the monthly zip of the same files
(YYYYMM01damlbmp_zone_csv.zip). DST days carry 23 or 25 rows; the mean is
over whatever hours the day had.

Verified 2026-10-04 against real files (research/iso-samples): N.Y.C.
2026-10-05 = 43.84, fall-back 2025-11-02 (25 rows) = 49.36."""
import csv
import io
import zipfile

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.lmp import daily_obs, window

URL = "https://mis.nyiso.com/public/csv/damlbmp/{d}damlbmp_zone.csv"
MONTH_ZIP = "https://mis.nyiso.com/public/csv/damlbmp/{m}01damlbmp_zone_csv.zip"
NAME_COL, PRICE_COL, TIME_COL = "Name", "LBMP ($/MWHr)", "Time Stamp"
PLAUSIBLE = (-100.0, 3000.0)
CATCHUP_DAYS = 5


def _default_get(url, timeout=60):
    return requests.get(url, timeout=timeout, headers={"User-Agent": "macrogauge (data pipeline)"})


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None, market_date: str | None = None) -> list:
    """source_id = the zone name exactly as in the Name column (e.g. N.Y.C.)."""
    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    days = [market_date] if market_date else window(CATCHUP_DAYS)
    out = []
    for day in days:
        resp = http_get(URL.format(d=day.replace("-", "")), timeout=60)
        if getattr(resp, "status_code", 200) == 404:
            continue
        resp.raise_for_status()
        out.extend(parse(resp.text, source_ids, day, vintage))
    return out


def fetch_month(source_ids: list[str], month: str, vintage_date: str | None = None,
                http_get=None) -> list:
    """Backfill: every day in the monthly zip (month = 'YYYY-MM')."""
    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    resp = http_get(MONTH_ZIP.format(m=month.replace("-", "")), timeout=120)
    resp.raise_for_status()
    out = []
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        for name in sorted(zf.namelist()):
            d = name[:8]
            day = f"{d[:4]}-{d[4:6]}-{d[6:8]}"
            out.extend(parse(zf.read(name).decode("utf-8-sig"), source_ids, day, vintage))
    return out


def parse(text: str, source_ids: list[str], day: str, vintage: str) -> list:
    reader = csv.DictReader(io.StringIO(text))
    cols = reader.fieldnames or []
    if NAME_COL not in cols or PRICE_COL not in cols or TIME_COL not in cols:
        raise ValueError(f"nyiso: columns {cols} lack {NAME_COL}/{PRICE_COL} (structure drift?)")
    rows = list(reader)
    out = []
    for zone in source_ids:
        vals = [r[PRICE_COL] for r in rows if r.get(NAME_COL) == zone]
        if not vals:
            raise ValueError(f"nyiso {zone}: zone not found for {day} (structure drift?)")
        out.append(daily_obs("NYISO", zone, day, vals, vintage, PLAUSIBLE))
    return out
