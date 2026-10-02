"""vast.ai GPU rental offers — median $/GPU-hr per GPU type.

Keyless public search API. Undocumented endpoint, so it is treated like a
scrape: required-field checks raise "structure drift?" and the collect-layer
isolation contains any failure. The median over live on-demand full-GPU
offers is this connector's one computation — a documented measurement, not
modeling. Thin-market honesty: days with fewer than MIN_OFFERS offers are
skipped entirely (the store's carry-forward absorbs the gap) rather than
storing a junk median.

Coverage (backlog #9, verified live 2026-09-28): the server returns at most
CAP (64) offers per query whatever `limit` says, and without an `order` the
64 it picks are server-chosen — so a deep market (RTX 4090: 150+ whole-GPU
offers) got a median over an arbitrary subset. Every query now carries an
explicit `order` (dph_total asc), and a saturated query (exactly CAP offers)
is split into contiguous `dph_total` bands, bisected until each band is under
the cap. The bands partition the server's dph_total axis, so their union is
the full offer set; offers are de-duplicated by id. The `id` field is NOT a
usable cursor (an `id` filter matched nothing past ~50M live), which is why
the split is by price. A request budget bounds the recursion; exhausting it
raises "structure drift?" (the cap or the filter semantics changed).
"""
import json
import statistics
import time
import urllib.parse

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import warn_partial
from pipeline.models import Observation

URL = "https://console.vast.ai/api/v0/bundles/"
MIN_OFFERS = 3
PLAUSIBLE = (0.05, 50.0)   # $/GPU-hr
CAP = 64                   # server-side per-query offer cap (live 2026-09-28)
ORDER = [["dph_total", "asc"]]
# first split of a saturated query: contiguous dph_total ($/hr, whole offer)
# bands; the last is open-ended. Bisection refines any band still at the cap.
EDGES = [0.0, 1.0, 4.0, 16.0, 64.0, None]
MIN_WIDTH = 0.001          # stop bisecting below this band width ($/hr)
MAX_REQUESTS = 60          # per SKU
# Banded queries multiply requests per run; the API answers bursts with 429
# (seen in a live run 2026-10-01). On the real network, pace requests and
# back off on 429 (honouring Retry-After). Tests inject http_get and never sleep.
PACE_SECONDS = 0.4
RETRY_429 = (2.0, 6.0)     # back-off schedule, seconds


def _query(gpu_name: str, band: tuple[float, float | None] | None = None) -> str:
    q = {"gpu_name": {"eq": gpu_name}, "rentable": {"eq": True},
         "gpu_frac": {"eq": 1}, "type": "on-demand", "limit": 1000,
         "order": ORDER}
    if band is not None:
        lo, hi = band
        q["dph_total"] = {"gte": lo} if hi is None else {"gte": lo, "lt": hi}
    return urllib.parse.quote(json.dumps(q))


def _get_offers(http_get, sid: str, band, budget: list[int]) -> list[dict]:
    budget[0] -= 1
    if budget[0] < 0:
        raise ValueError(f"vast.ai {sid}: pagination budget {MAX_REQUESTS} "
                         "exhausted (cap or filter semantics changed — "
                         "structure drift?)")
    url = f"{URL}?q={_query(sid, band)}"
    real = http_get is requests.get
    if real:
        time.sleep(PACE_SECONDS)
    resp = http_get(url, timeout=60)
    for wait in RETRY_429:
        if getattr(resp, "status_code", 200) != 429:
            break
        retry_after = (getattr(resp, "headers", None) or {}).get("Retry-After")
        delay = float(retry_after) if retry_after and str(retry_after).isdigit() else wait
        if real:
            time.sleep(min(delay, 30.0))
        resp = http_get(url, timeout=60)
    resp.raise_for_status()
    offers = resp.json().get("offers")
    if offers is None:
        raise ValueError(f"vast.ai {sid}: no 'offers' key (structure drift?)")
    return offers


def _band_offers(http_get, sid: str, lo: float, hi: float | None,
                 budget: list[int]) -> list[dict]:
    offers = _get_offers(http_get, sid, (lo, hi), budget)
    if len(offers) < CAP:
        return offers
    if hi is None:
        # open top band saturated: split at 4x its floor (floor 0 -> 1)
        mid = lo * 4 if lo > 0 else 1.0
        return (_band_offers(http_get, sid, lo, mid, budget)
                + _band_offers(http_get, sid, mid, None, budget))
    if hi - lo <= MIN_WIDTH:
        return offers   # 64 identical-priced offers: take what the cap gives
    mid = round((lo + hi) / 2, 6)
    return (_band_offers(http_get, sid, lo, mid, budget)
            + _band_offers(http_get, sid, mid, hi, budget))


def _all_offers(http_get, sid: str) -> list[dict]:
    """Every live offer for the SKU: one ordered query when the market is
    under the cap; the banded split when it is saturated."""
    budget = [MAX_REQUESTS]
    offers = _get_offers(http_get, sid, None, budget)
    if len(offers) < CAP:
        return offers
    merged: list[dict] = []
    for lo, hi in zip(EDGES, EDGES[1:]):
        merged += _band_offers(http_get, sid, lo, hi, budget)
    seen, out = set(), []
    for o in merged:
        oid = o.get("id")
        if oid is None:
            raise ValueError(f"vast.ai {sid}: offer missing id (structure drift?)")
        if oid not in seen:
            seen.add(oid)
            out.append(o)
    return out


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = the vast.ai gpu_name string (spike-pinned)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out, errors = [], []
    for sid in source_ids:
        try:
            out.extend(_sku(http_get, sid, vintage))
        except Exception as e:  # per-SKU isolation: one throttled SKU must not drop the rest
            errors.append((sid, e))
    if errors and len(errors) == len(source_ids):
        raise errors[0][1]  # every SKU failed: the source is down, not thin
    warn_partial("VASTAI", errors)
    return out


def _sku(http_get, sid: str, vintage: str) -> list[Observation]:
    out = []
    offers = _all_offers(http_get, sid)
    prices = []
    for o in offers:
        if "dph_total" not in o or "num_gpus" not in o:
            raise ValueError(f"vast.ai {sid}: offer missing dph_total/"
                             "num_gpus (structure drift?)")
        if o["num_gpus"]:
            prices.append(o["dph_total"] / o["num_gpus"])
    if len(prices) < MIN_OFFERS:
        return out   # thin market today — skip; carry-forward absorbs it
    value = round(statistics.median(prices), 4)
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"vast.ai {sid}: median {value} implausible "
                         f"(range {PLAUSIBLE}) — structure drift?")
    out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                           vintage_date=vintage, source="VASTAI",
                           route="API"))
    return out
