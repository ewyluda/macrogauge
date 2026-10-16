import copy
import json
from pathlib import Path

import pytest
import requests

from pipeline.connectors import openrouter
from pipeline.connectors.util import PartialFetchWarning
from pipeline.registry import load_registry

# /api/v1/models/{id}/endpoints for the seven roster models, verbatim (2026-10-16)
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "openrouter_endpoints.json").read_text())
SIDS = [s.source_id for s in load_registry()[1] if s.source == "OPENROUTER"]


class _R:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Not Found")

    def json(self):
        return self._payload


def _get(fixture, seen=None):
    def get(url, timeout=None):
        if seen is not None:
            seen.append(url)
        model_id = url.removeprefix("https://openrouter.ai/api/v1/models/").removesuffix("/endpoints")
        if model_id not in fixture:
            return _R({"error": {"message": "Not Found", "code": 404}}, status=404)
        return _R(fixture[model_id])
    return get


def _by_code(obs):
    return {o.series_code.split("@")[0] + ":" + o.series_code.rpartition(":")[2]: o.value for o in obs}


def test_every_registry_pin_prices_its_makers_endpoint():
    """The registry's pins resolve in the real payload, one request per model,
    and each price is the maker's own endpoint at its base rate."""
    seen = []
    obs = openrouter.fetch(SIDS, vintage_date="2026-10-16", http_get=_get(FIXTURE, seen))
    assert len(obs) == len(SIDS) == 14
    assert len(seen) == 7 and all(u.endswith("/endpoints") for u in seen)
    assert _by_code(obs) == pytest.approx({
        "anthropic/claude-opus-5.5:prompt": 4.0, "anthropic/claude-opus-5.5:completion": 20.0,
        "openai/gpt-6.1-sol:prompt": 2.0, "openai/gpt-6.1-sol:completion": 10.0,
        # the top-level /models price was InferenceNet fp4's 0.405 / 15.45
        "moonshotai/kimi-k3:prompt": 3.0, "moonshotai/kimi-k3:completion": 15.0,
        # ... and Wafer us's 0.079 / 4.80
        "z-ai/glm-5.3:prompt": 1.4, "z-ai/glm-5.3:completion": 4.4,
        # base rate: the off-peak `overrides` (0.15 / 0.60) are ignored
        "deepseek/deepseek-v4.1-flash:prompt": 0.3, "deepseek/deepseek-v4.1-flash:completion": 1.2,
        # AI Studio's own list price; `discount` ignored, Vertex us's +10% not taken
        "google/gemini-3.8-flash:prompt": 0.75, "google/gemini-3.8-flash:completion": 3.75,
        "openai/gpt-6-luna:prompt": 0.1, "openai/gpt-6-luna:completion": 0.5,
    })
    assert {(o.source, o.route, o.obs_date) for o in obs} == {("OPENROUTER", "API", "2026-10-16")}
    assert {o.series_code for o in obs} == set(SIDS)   # collect maps source_id -> code


def test_pinned_tag_is_exact_not_a_prefix():
    """'openai' is the standard tier; 'openai/flex' and 'openai/fast' are other prices."""
    obs = openrouter.fetch(["openai/gpt-6-luna@openai/flex:prompt"],
                           vintage_date="2026-10-16", http_get=_get(FIXTURE))
    assert [o.value for o in obs] == [pytest.approx(0.05)]


def test_missing_pinned_endpoint_is_partial_structure_drift():
    """A renamed or withdrawn maker endpoint drops that model only, loudly."""
    fx = copy.deepcopy(FIXTURE)
    eps = fx["moonshotai/kimi-k3"]["data"]["endpoints"]
    fx["moonshotai/kimi-k3"]["data"]["endpoints"] = [e for e in eps if e["tag"] != "moonshotai/mxfp4"]
    with pytest.warns(PartialFetchWarning, match=r"moonshotai/mxfp4.*structure drift"):
        obs = openrouter.fetch(SIDS, vintage_date="2026-10-16", http_get=_get(fx))
    assert len(obs) == 12 and not any("kimi" in o.series_code for o in obs)


def test_gone_model_is_partial_not_silent():
    fx = {k: v for k, v in FIXTURE.items() if k != "z-ai/glm-5.3"}
    with pytest.warns(PartialFetchWarning, match="z-ai/glm-5.3"):
        obs = openrouter.fetch(SIDS, vintage_date="2026-10-16", http_get=_get(fx))
    assert len(obs) == 12


def test_every_model_failing_raises():
    with pytest.raises(ValueError, match="structure drift"):
        openrouter.fetch(["z-ai/glm-5.3@nobody:prompt", "openai/gpt-6-luna@nobody:prompt"],
                         vintage_date="2026-10-16", http_get=_get(FIXTURE))


def test_no_endpoints_list_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        openrouter.fetch(["openai/gpt-6-luna@openai:prompt"], vintage_date="2026-10-16",
                         http_get=_get({"openai/gpt-6-luna": {"data": []}}))


def test_implausible_price_is_structure_drift():
    fx = copy.deepcopy(FIXTURE)
    for e in fx["openai/gpt-6-luna"]["data"]["endpoints"]:
        if e["tag"] == "openai":
            e["pricing"]["prompt"] = "1"   # $1 per token = $1M/Mtok
    with pytest.raises(ValueError, match="implausible"):
        openrouter.fetch(["openai/gpt-6-luna@openai:prompt"], vintage_date="2026-10-16",
                         http_get=_get(fx))
