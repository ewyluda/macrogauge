"""OpenRouter model prices — $/Mtok for a fixed model basket.

Keyless public API. Prices are OpenRouter's routed best-available price, a
caveat that belongs to the future index's methodology, not to collection.
Failure semantics are deliberate: a basket model missing from the response
skips its two series (deprecation then surfaces as per-series staleness
within 7 days — the designed early-warning), while an unparsable response or
a fully-missing basket raises. Basket substitutions are an index-construction
decision (wave 3b), never made silently here.
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://openrouter.ai/api/v1/models"
PLAUSIBLE = (0.01, 500.0)   # $/Mtok


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = '<model_id>:prompt' or '<model_id>:completion'."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(URL, timeout=60)
    resp.raise_for_status()
    data = resp.json().get("data")
    if not isinstance(data, list):
        raise ValueError("openrouter: no 'data' list (structure drift?)")
    pricing = {m.get("id"): (m.get("pricing") or {}) for m in data}
    out = []
    for sid in source_ids:
        model_id, _, direction = sid.rpartition(":")
        p = pricing.get(model_id)
        if p is None:
            continue   # deprecated model -> series goes stale (early-warning)
        raw = p.get(direction)   # "prompt" | "completion", USD per token
        if raw in (None, ""):
            continue
        value = round(float(raw) * 1_000_000, 6)   # USD/token -> $/Mtok
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            raise ValueError(f"openrouter {sid}: {value} $/Mtok implausible "
                             f"(range {PLAUSIBLE}) — structure drift?")
        out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                               vintage_date=vintage, source="OPENROUTER",
                               route="API"))
    if not out:
        raise ValueError(
            "openrouter: zero basket models found (structure drift?)")
    return out
