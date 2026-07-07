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


def test_fetch_normalizes_monthly_and_keeps_weekly():
    obs = eia.fetch(["ELEC.PRICE.US-RES.M", "PET.EMM_EPMR_PTE_NUS_DPG.W"], "eia-key",
                    vintage_date="2026-07-07", http_get=fake_get)
    monthly = [o for o in obs if o.series_code == "ELEC.PRICE.US-RES.M"]
    weekly = [o for o in obs if o.series_code == "PET.EMM_EPMR_PTE_NUS_DPG.W"]
    assert [(o.obs_date, o.value) for o in monthly] == [("2026-05-01", 17.45),
                                                        ("2026-04-01", 17.21)]
    assert [(o.obs_date, o.value) for o in weekly] == [("2026-06-29", 3.412),
                                                       ("2026-06-22", 3.388)]
    assert obs[0].source == "EIA" and obs[0].route == "API"
