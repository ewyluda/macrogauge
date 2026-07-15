"""vast.ai GPU rental offers — median $/GPU-hr per GPU type.

Keyless public search API. Undocumented endpoint, so it is treated like a
scrape: required-field checks raise "structure drift?" and the collect-layer
isolation contains any failure. The median over live on-demand full-GPU
offers is this connector's one computation — a documented measurement, not
modeling. Thin-market honesty: days with fewer than MIN_OFFERS offers are
skipped entirely (the store's carry-forward absorbs the gap) rather than
storing a junk median.
"""
import json
import statistics
import urllib.parse

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://console.vast.ai/api/v0/bundles/"
MIN_OFFERS = 3
PLAUSIBLE = (0.05, 50.0)   # $/GPU-hr


def _query(gpu_name: str) -> str:
    q = {"gpu_name": {"eq": gpu_name}, "rentable": {"eq": True},
         "gpu_frac": {"eq": 1}, "type": "on-demand", "limit": 1000}
    return urllib.parse.quote(json.dumps(q))


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = the vast.ai gpu_name string (spike-pinned)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out = []
    for sid in source_ids:
        resp = http_get(f"{URL}?q={_query(sid)}", timeout=60)
        resp.raise_for_status()
        offers = resp.json().get("offers")
        if offers is None:
            raise ValueError(f"vast.ai {sid}: no 'offers' key (structure drift?)")
        prices = []
        for o in offers:
            if "dph_total" not in o or "num_gpus" not in o:
                raise ValueError(f"vast.ai {sid}: offer missing dph_total/"
                                 "num_gpus (structure drift?)")
            if o["num_gpus"]:
                prices.append(o["dph_total"] / o["num_gpus"])
        if len(prices) < MIN_OFFERS:
            continue   # thin market today — skip; carry-forward absorbs it
        value = round(statistics.median(prices), 4)
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            raise ValueError(f"vast.ai {sid}: median {value} implausible "
                             f"(range {PLAUSIBLE}) — structure drift?")
        out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                               vintage_date=vintage, source="VASTAI",
                               route="API"))
    return out
