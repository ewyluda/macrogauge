import json
from pathlib import Path

from pipeline.connectors import fred

FIXTURE = Path(__file__).parent / "fixtures" / "fred_cpiaucns.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert params["series_id"] == "CPIAUCNS"
    assert params["api_key"] == "test-key"
    assert params["file_type"] == "json"
    assert params["observation_start"] == "2017-01-01"
    return FakeResponse(json.loads(FIXTURE.read_text()))


def test_fetch_parses_and_skips_missing():
    obs = fred.fetch(["CPIAUCNS"], "test-key", vintage_date="2026-07-07",
                     http_get=fake_get)
    assert len(obs) == 3  # the "." row is skipped
    first = obs[0]
    assert (first.series_code, first.obs_date, first.value) == ("CPIAUCNS", "2025-04-01", 312.9)
    assert (first.vintage_date, first.source, first.route) == ("2026-07-07", "FRED", "API")


def test_today_et_format():
    assert len(fred.today_et()) == 10  # YYYY-MM-DD
