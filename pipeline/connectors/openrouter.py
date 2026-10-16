"""OpenRouter model prices — $/Mtok for a fixed model basket.

Keyless public API. Each model is priced at ONE pinned endpoint, its maker's
own (the provider tag after '@' in the source_id, e.g. 'deepseek',
'moonshotai/mxfp4'), at that endpoint's base prompt/completion rate:
`overrides` (DeepSeek's off-peak hours, OpenAI's long-context tier) and
`discount` are ignored. The top-level /models price it replaces (2026-10-16)
is the endpoint OpenRouter routes to, often a third-party fp4 or regional
host, and it switched between hosts from run to run.
Failure semantics are deliberate: a model whose endpoints call fails, or
whose pinned endpoint is gone, drops its two series as a partial failure
(published in sources_status; the series then goes stale within 7 days),
and only every model failing raises. Basket substitutions are an
index-construction decision, never made silently here.
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import warn_partial
from pipeline.models import Observation

URL = "https://openrouter.ai/api/v1/models/{model_id}/endpoints"
PLAUSIBLE = (0.01, 500.0)   # $/Mtok


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = '<model_id>@<endpoint tag>:prompt' or ':completion'."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    pinned: dict[str, list[str]] = {}
    for sid in source_ids:
        pinned.setdefault(sid.rpartition(":")[0], []).append(sid)
    out, errors = [], []
    for model_tag, sids in pinned.items():
        try:
            out.extend(_model(http_get, model_tag, sids, vintage))
        except Exception as e:  # per-model isolation: one renamed endpoint must not drop the rest
            errors.append((model_tag, e))
    if errors and not out:
        raise errors[0][1]   # every model failed: the source is down, not thin
    warn_partial("OPENROUTER", errors)
    return out


def _model(http_get, model_tag: str, sids: list[str], vintage: str) -> list[Observation]:
    model_id, _, tag = model_tag.partition("@")
    resp = http_get(URL.format(model_id=model_id), timeout=60)
    resp.raise_for_status()
    data = resp.json().get("data")
    endpoints = data.get("endpoints") if isinstance(data, dict) else None
    if not isinstance(endpoints, list):
        raise ValueError(f"openrouter {model_id}: no 'endpoints' list (structure drift?)")
    pricing = next((e.get("pricing") or {} for e in endpoints if e.get("tag") == tag), None)
    if pricing is None:
        raise ValueError(f"openrouter {model_id}: pinned endpoint {tag!r} missing "
                         "(structure drift?)")
    out = []
    for sid in sids:
        direction = sid.rpartition(":")[2]   # "prompt" | "completion", USD per token
        raw = pricing.get(direction)
        if raw in (None, ""):
            raise ValueError(f"openrouter {sid}: no {direction} price (structure drift?)")
        value = round(float(raw) * 1_000_000, 6)   # USD/token -> $/Mtok
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            raise ValueError(f"openrouter {sid}: {value} $/Mtok implausible "
                             f"(range {PLAUSIBLE}) — structure drift?")
        out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                               vintage_date=vintage, source="OPENROUTER",
                               route="API"))
    return out
