import json
from pathlib import Path

from pipeline.connectors import fmp

FIXTURE = Path(__file__).parent / "fixtures" / "fmp_quote.json"
HISTORY_FIXTURE = Path(__file__).parent / "fixtures" / "fmp_history.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert "batch-quote" in url
    assert params["apikey"] == "fmp-key"
    assert params["symbols"] == "GCUSD,CLUSD"
    return FakeResponse(json.loads(FIXTURE.read_text()))


def test_fetch_quotes_dated_from_timestamp():
    obs = fmp.fetch(["GCUSD", "CLUSD"], "fmp-key", vintage_date="2026-07-07",
                    http_get=fake_get)
    # 1783440000 = 2026-07-07 12:00:00 UTC = 08:00 ET
    assert [(o.series_code, o.obs_date, o.value) for o in obs] == [
        ("GCUSD", "2026-07-07", 3412.5),
        ("CLUSD", "2026-07-07", 71.85)]
    assert obs[0].source == "FMP" and obs[0].route == "API"


def test_fetch_history_parses_daily_rows():
    fixture = json.loads(HISTORY_FIXTURE.read_text())

    def fake_get(url, params=None, timeout=None):
        assert "historical-price-eod" in url
        assert params["symbol"] in ("GCUSD",)
        assert params["from"] == "2017-01-01"
        return FakeResponse(fixture)

    obs = fmp.fetch_history(["GCUSD"], "k", vintage_date="2026-07-10", http_get=fake_get)
    assert len(obs) == len(fixture)
    assert obs[0].series_code == "GCUSD"
    assert obs[0].route == "API" and obs[0].source == "FMP"
    assert obs[0].vintage_date == "2026-07-10"
