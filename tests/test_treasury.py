import json
from pathlib import Path

from pipeline.connectors import treasury

FIXTURE = Path(__file__).parent / "fixtures" / "treasury_debt.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert "debt_to_penny" in url
    assert params["filter"] == "record_date:gte:2017-01-01"
    return FakeResponse(json.loads(FIXTURE.read_text()))


def test_fetch_daily_debt():
    obs = treasury.fetch(vintage_date="2026-07-07", http_get=fake_get)
    assert [(o.obs_date, o.value) for o in obs] == [
        ("2026-07-02", 38712345678901.23),
        ("2026-07-01", 38709876543210.99)]
    assert obs[0].series_code == "fiscal_debt_total"
    assert obs[0].source == "TREASURY" and obs[0].route == "API"
