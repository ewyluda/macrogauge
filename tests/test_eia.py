import json
from pathlib import Path

from pipeline.connectors import eia

FIXTURES = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert params["api_key"] == "eia-key"
    if "ELEC.PRICE.US-RES.M" in url:
        return FakeResponse(json.loads((FIXTURES / "eia_monthly.json").read_text()))
    if "PET.EMM_EPMR_PTE_NUS_DPG.W" in url:
        return FakeResponse(json.loads((FIXTURES / "eia_weekly.json").read_text()))
    raise AssertionError(f"unexpected url {url}")


def test_fetch_tolerates_one_bad_series_keeps_rest():
    # per-series isolation, same convention as fred.fetch: one 500ing/removed
    # id must not kill the whole source (51 EIA_STATE_RES ids ride one call)
    def flaky_get(url, params=None, timeout=None):
        if "BAD.SERIES.M" in url:
            raise RuntimeError("500 server error")
        return fake_get(url, params=params, timeout=timeout)

    obs = eia.fetch(["BAD.SERIES.M", "ELEC.PRICE.US-RES.M"], "eia-key",
                    vintage_date="2026-07-07", http_get=flaky_get)
    assert {o.series_code for o in obs} == {"ELEC.PRICE.US-RES.M"}
    assert len(obs) == 2


def test_fetch_raises_when_all_series_fail():
    def dead_get(url, params=None, timeout=None):
        raise RuntimeError("500 server error")

    try:
        eia.fetch(["A.M", "B.M"], "eia-key", vintage_date="2026-07-07",
                  http_get=dead_get)
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "no series loaded" in str(e)


def test_fetch_single_series_failure_surfaces_original_error():
    def dead_get(url, params=None, timeout=None):
        raise ValueError("boom")

    try:
        eia.fetch(["A.M"], "eia-key", vintage_date="2026-07-07", http_get=dead_get)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "boom" in str(e)


def test_fetch_normalizes_monthly_and_keeps_weekly():
    obs = eia.fetch(["ELEC.PRICE.US-RES.M", "PET.EMM_EPMR_PTE_NUS_DPG.W"], "eia-key",
                    vintage_date="2026-07-07", http_get=fake_get)
    monthly = [o for o in obs if o.series_code == "ELEC.PRICE.US-RES.M"]
    weekly = [o for o in obs if o.series_code == "PET.EMM_EPMR_PTE_NUS_DPG.W"]
    assert [(o.obs_date, o.value) for o in monthly] == [("2026-05-01", 17.45),
                                                        ("2026-04-01", 17.21)]
    assert [(o.obs_date, o.value) for o in weekly] == [("2026-06-29", 3.412),
                                                       ("2026-06-22", 3.388)]
    assert len(obs) == 4  # the null 2026-03 monthly row is skipped
    assert obs[0].source == "EIA" and obs[0].route == "API"


def test_fetch_partial_failure_emits_warning():
    import pytest
    from pipeline.connectors.util import PartialFetchWarning

    def flaky_get(url, params=None, timeout=None):
        if "BAD.SERIES.M" in url:
            raise RuntimeError("500 server error")
        return fake_get(url, params=params, timeout=timeout)

    with pytest.warns(PartialFetchWarning, match="BAD.SERIES.M: RuntimeError"):
        eia.fetch(["BAD.SERIES.M", "ELEC.PRICE.US-RES.M"], "eia-key",
                  vintage_date="2026-07-07", http_get=flaky_get)
