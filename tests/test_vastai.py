import json
import statistics
import urllib.parse
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


# --- backlog #9: explicit order + banded split past the 64-offer cap -------
BANDED = json.loads(
    (Path(__file__).parent / "fixtures" / "vastai_banded.json").read_text())


def _q(url):
    return json.loads(urllib.parse.unquote(url.split("?q=", 1)[1]))


def _banded_get(calls):
    """Replay the recorded 2026-09-28 live session, keyed by the query's SKU
    and dph_total band (None = the unbanded first query)."""
    def get(url, timeout=None):
        q = _q(url)
        calls.append(q)
        return _R(BANDED["responses"][json.dumps([q["gpu_name"]["eq"], q.get("dph_total")])])
    return get


def test_every_query_carries_explicit_order():
    calls = []
    vastai.fetch(["RTX 4090", "B300"], vintage_date="2026-09-28",
                 http_get=_banded_get(calls))
    assert calls and all(q["order"] == [["dph_total", "asc"]] for q in calls)


def test_saturated_query_is_split_into_bands_covering_full_market():
    calls = []
    obs = vastai.fetch(["RTX 4090"], vintage_date="2026-09-28",
                       http_get=_banded_get(calls))
    bands = [q.get("dph_total") for q in calls]
    assert bands[0] is None                              # first query hit the cap
    assert {"gte": 0.0, "lt": 0.5} in bands              # [0,1) re-saturated -> bisected
    assert {"gte": 0.5, "lt": 1.0} in bands
    assert {"gte": 64.0} in bands                        # open top band
    leaf = [BANDED["responses"][json.dumps(["RTX 4090", b])]["offers"]
            for b in bands if b not in (None, {"gte": 0.0, "lt": 1.0})]
    ids = {o["id"] for offers in leaf for o in offers}
    assert len(ids) > vastai.CAP                         # 157 live vs 64 capped
    prices = [o["dph_total"] / o["num_gpus"] for offers in leaf
              for o in offers if o["num_gpus"]]
    assert obs[0].value == pytest.approx(round(statistics.median(prices), 4))
    assert obs[0].value == pytest.approx(0.4956, abs=1e-4)   # recorded live


def test_unsaturated_query_is_a_single_request():
    calls = []
    obs = vastai.fetch(["B300"], vintage_date="2026-09-28",
                       http_get=_banded_get(calls))
    assert len(calls) == 1
    assert obs[0].value == pytest.approx(11.2503, abs=1e-4)   # recorded live


def test_duplicate_offers_across_bands_counted_once():
    cap = [{"id": i, "dph_total": 0.5, "num_gpus": 1} for i in range(vastai.CAP)]
    few = [{"id": 1, "dph_total": 0.5, "num_gpus": 1},
           {"id": 2, "dph_total": 0.6, "num_gpus": 1}]

    def get(url, timeout=None):
        return _R({"offers": cap if "dph_total" not in _q(url) else few})
    # every band returns ids {1, 2}: de-duplicated to 2 offers -> thin -> skip
    assert vastai.fetch(["X"], vintage_date="2026-09-28", http_get=get) == []


def test_runaway_split_is_structure_drift():
    cap = {"offers": [{"id": i, "dph_total": 0.5 + i, "num_gpus": 1}
                      for i in range(vastai.CAP)]}
    with pytest.raises(ValueError, match="structure drift"):
        vastai.fetch(["X"], vintage_date="2026-09-28",
                     http_get=lambda url, timeout=None: _R(cap))


def test_429_backs_off_and_retries_then_succeeds():
    import json as _json
    from pipeline.connectors import vastai as _v

    class R:
        def __init__(self, code, offers=None):
            self.status_code, self._o, self.headers = code, offers, {"Retry-After": "1"}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return {"offers": self._o}

    offers = [{"id": i, "dph_total": 0.5 + i / 100, "num_gpus": 1} for i in range(5)]
    calls = []

    def get(url, timeout=None):
        calls.append(url)
        return R(429) if len(calls) == 1 else R(200, offers)

    obs = _v.fetch(["RTX 4090"], vintage_date="2026-10-01", http_get=get)
    assert len(calls) == 2 and obs[0].value == 0.52


def test_one_sku_failing_is_partial_not_fatal():
    import warnings
    from pipeline.connectors import vastai as _v
    from pipeline.connectors.util import PartialFetchWarning

    class R:
        def __init__(self, code, offers=None):
            self.status_code, self._o, self.headers = code, offers, {}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return {"offers": self._o}

    good = [{"id": i, "dph_total": 2.0 + i / 10, "num_gpus": 1} for i in range(5)]

    def get(url, timeout=None):
        return R(429) if "H100" in __import__("urllib.parse").parse.unquote(url) else R(200, good)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        obs = _v.fetch(["H100 SXM", "H200"], vintage_date="2026-10-01", http_get=get)
    assert [o.series_code for o in obs] == ["H200"]
    assert any(issubclass(w.category, PartialFetchWarning) for w in caught)
