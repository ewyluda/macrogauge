import json
from pathlib import Path

import pytest

from pipeline.connectors import vastai

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "vastai_bundles.json").read_text())


class _R:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _get(payload):
    return lambda url, timeout=None: _R(payload)


def test_happy_path_median_per_gpu():
    obs = vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",   # SPIKE-FINAL
                       http_get=_get(FIXTURE))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "H100 SXM"                            # SPIKE-FINAL
    # median of the fixture's per-GPU prices — SPIKE-FINAL expected value
    assert o.value == pytest.approx(1.7614, rel=1e-3)
    assert (o.source, o.route) == ("VASTAI", "API")


def test_thin_market_skipped_not_error():
    thin = {"offers": FIXTURE["offers"][: vastai.MIN_OFFERS - 1]}
    assert vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",
                        http_get=_get(thin)) == []


def test_missing_offers_key_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",
                     http_get=_get({"unexpected": []}))


def test_missing_price_fields_is_structure_drift():
    bad = {"offers": [{"gpu_name": "H100 SXM"}] * 5}
    with pytest.raises(ValueError, match="structure drift"):
        vastai.fetch(["H100 SXM"], vintage_date="2026-07-15", http_get=_get(bad))


def test_multi_gpu_offers_normalized_per_gpu():
    offers = {"offers": [{"dph_total": 8.0, "num_gpus": 4},
                         {"dph_total": 2.0, "num_gpus": 1},
                         {"dph_total": 4.0, "num_gpus": 2}]}
    obs = vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",
                       http_get=_get(offers))
    assert obs[0].value == pytest.approx(2.0)   # all normalize to 2.0/GPU-hr
