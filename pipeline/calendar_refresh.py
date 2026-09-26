"""Refresh store/calendar/releases.json from FRED's release/dates API.

FRED mirrors each agency's published schedule, including future dates
(`include_release_dates_with_no_data=true`). Reference month = the month
before the release month for all four releases tracked here (CPI and PPI
mid-month, Personal Income & Outlays at month-end, the Employment Situation
on the first Friday) — asserted per entry so an off-pattern date fails loudly
instead of mislabelling a month.

Runs in its own isolated block right after collection; a failure leaves the
previous refreshed file (or the hand-seeded config) in place.
"""
import json
from datetime import date, timedelta
from pathlib import Path

import requests

from pipeline.connectors.util import get_text

API = "https://api.stlouisfed.org/fred/release/dates"
RELEASES = {"cpi": 10, "ppi": 46, "pce": 54, "nfp": 50}


def _ref_month(release_date: str) -> str:
    d = date.fromisoformat(release_date).replace(day=1) - timedelta(days=1)
    return d.strftime("%Y-%m")


def fetch(api_key: str, today: str, http_get=None) -> dict[str, list[dict]]:
    http_get = http_get or requests.get
    start = (date.fromisoformat(today) - timedelta(days=120)).isoformat()
    out = {}
    for key, rid in RELEASES.items():
        url = (f"{API}?release_id={rid}&api_key={api_key}&file_type=json"
               f"&realtime_start={start}&realtime_end=9999-12-31"
               f"&include_release_dates_with_no_data=true&sort_order=asc&limit=100")
        rows = json.loads(get_text(url, http_get)).get("release_dates", [])
        dates = sorted({r["date"] for r in rows if r.get("date", "") >= start})
        if not dates:
            raise ValueError(f"FRED release/dates rid={rid}: no dates (structure drift?)")
        out[key] = [{"release_date": d, "reference_month": _ref_month(d)} for d in dates]
    return out


def write(calendar: dict, path: Path, today: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"_source": "FRED release/dates", "_refreshed": today, **calendar}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path
