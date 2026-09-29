"""NY Fed Global Supply Chain Pressure Index (GSCPI) — monthly, std devs.

Keyless public CSV behind the NY Fed's GSCPI interactive (verified live
2026-09-28). The advertised download, .../gscpi/downloads/gscpi_data.xlsx,
is a legacy BIFF .xls despite its extension (openpyxl cannot read it, and
its file metadata was last saved 2024-11); the interactive's own data file
is plain CSV and is a VINTAGE MATRIX: one row per reference month
("30-Sep-1997" = month-end), one column per publication vintage ("Jan-22"
.. "Sep-26"), "#N/A" where a vintage had not yet covered the month. The
LAST column is the current publication — the only one read here; earlier
columns are the index's own revision history.

Treated as an unofficial endpoint (it is an interactive's data file, not a
documented download): the header shape, the vintage-label pattern, the
date format and a plausible-value range are all pinned, and any deviation
raises "structure drift?" into collect isolation.
"""
import csv
import io
import re
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = ("https://www.newyorkfed.org/medialibrary/research/interactives/data/"
       "gscpi/gscpi_interactive_data.csv")
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
VINTAGE_RE = re.compile(r"^[A-Z][a-z]{2}-\d{2}$")      # "Sep-26"
PLAUSIBLE = (-5.0, 10.0)    # std devs from average (record: ~4.3, Dec 2021)
MIN_MONTHS = 300            # the series starts 1997-09 (~350 months by 2026)


def _default_get(url, timeout=60):
    return requests.get(url, timeout=timeout, headers={"User-Agent": _UA})


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = "GSCPI" (one series). Every month of the current vintage
    publishes each run; the store's value-dedupe keeps only the changes, so
    a revised month lands as a new vintage row."""
    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    resp = http_get(URL, timeout=60)
    resp.raise_for_status()
    rows = list(csv.reader(io.StringIO(resp.text)))
    if not rows or not rows[0] or rows[0][0].strip() != "Date":
        raise ValueError("nyfed gscpi: header does not start with 'Date' "
                         "(structure drift?)")
    header = [h.strip() for h in rows[0]]
    col = len(header) - 1
    while col > 0 and not header[col]:
        col -= 1
    label = header[col]
    if col < 1 or not VINTAGE_RE.match(label):
        raise ValueError(f"nyfed gscpi: last vintage column {label!r} is not "
                         "'Mon-YY' (structure drift?)")
    pub = datetime.strptime(label, "%b-%y")
    out = []
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue                      # trailing blank row(s)
        try:
            month = datetime.strptime(r[0].strip(), "%d-%b-%Y")
        except ValueError:
            raise ValueError(f"nyfed gscpi: date {r[0]!r} is not DD-Mon-YYYY "
                             "(structure drift?)") from None
        cell = r[col].strip() if col < len(r) else ""
        if cell in ("", "#N/A"):
            continue
        value = float(cell)
        if not PLAUSIBLE[0] <= value <= PLAUSIBLE[1]:
            raise ValueError(f"nyfed gscpi {r[0]}: {value} outside {PLAUSIBLE} "
                             "(structure drift?)")
        if (month.year, month.month) >= (pub.year, pub.month):
            raise ValueError(f"nyfed gscpi: vintage {label} covers {r[0]} — a "
                             "publication cannot cover its own month (structure drift?)")
        out.append(Observation(series_code=source_ids[0] if source_ids else "GSCPI",
                               obs_date=f"{month.year}-{month.month:02d}-01",
                               value=value, vintage_date=vintage,
                               source="NYFED", route="CSV"))
    if len(out) < MIN_MONTHS:
        raise ValueError(f"nyfed gscpi: only {len(out)} months in vintage {label} "
                         f"(< {MIN_MONTHS}; structure drift?)")
    return out
