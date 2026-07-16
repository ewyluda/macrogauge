import json
from pathlib import Path

import pytest

from pipeline.connectors import openrouter

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "openrouter_models.json").read_text())


class _R:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _get(payload):
    return lambda url, timeout=None: _R(payload)


def test_happy_path_dollars_per_mtok():
    obs = openrouter.fetch(["openai/gpt-4o:prompt",              # SPIKE-FINAL id
                            "openai/gpt-4o:completion"],
                           vintage_date="2026-07-15", http_get=_get(FIXTURE))
    by_code = {o.series_code: o.value for o in obs}
    # fixture pricing.prompt "0.0000025" -> $2.50/Mtok — SPIKE-FINAL values
    assert by_code["openai/gpt-4o:prompt"] == pytest.approx(2.5)
    assert by_code["openai/gpt-4o:completion"] == pytest.approx(10.0)
    assert {(o.source, o.route) for o in obs} == {("OPENROUTER", "API")}


def test_missing_model_skipped_silently():
    obs = openrouter.fetch(["gone/model:prompt", "openai/gpt-4o:prompt"],
                           vintage_date="2026-07-15", http_get=_get(FIXTURE))
    assert [o.series_code for o in obs] == ["openai/gpt-4o:prompt"]


def test_zero_basket_models_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        openrouter.fetch(["gone/model:prompt"], vintage_date="2026-07-15",
                         http_get=_get(FIXTURE))


def test_no_data_list_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        openrouter.fetch(["openai/gpt-4o:prompt"], vintage_date="2026-07-15",
                         http_get=_get({"models": []}))
