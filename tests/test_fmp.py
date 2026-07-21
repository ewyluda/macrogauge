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


EQUITY_FIXTURE = Path(__file__).parent / "fixtures" / "fmp_equity_quote.json"


def fake_equity_get(url, params=None, timeout=None):
    assert "batch-quote" in url
    assert params["apikey"] == "fmp-key"
    return FakeResponse(json.loads(EQUITY_FIXTURE.read_text()))


def test_fetch_equity_emits_px_and_cap_rows():
    obs = fmp.fetch_equity(["MSFT:px", "MSFT:cap", "CRWV:cap"], "fmp-key",
                           vintage_date="2026-07-21", http_get=fake_equity_get)
    got = {(o.series_code): o.value for o in obs}
    assert got == {"MSFT:px": 512.3, "MSFT:cap": 3807.0, "CRWV:cap": 39.78}
    assert all(o.source == "FMP_EQ" and o.route == "API" for o in obs)
    assert obs[0].obs_date == "2026-07-07"


def test_fetch_equity_partial_warns_on_implausible_and_missing():
    import pytest
    from pipeline.connectors.util import PartialFetchWarning
    with pytest.warns(PartialFetchWarning) as caught:
        obs = fmp.fetch_equity(["JUNK:px", "JUNK:cap", "GONE:cap"], "fmp-key",
                               http_get=fake_equity_get)
    assert obs == []
    msg = str(caught[0].message)
    assert "JUNK:px" in msg and "JUNK:cap" in msg and "GONE" in msg


def test_fetch_equity_requests_each_symbol_once():
    calls = []

    def spy_get(url, params=None, timeout=None):
        calls.append(params["symbols"])
        return FakeResponse(json.loads(EQUITY_FIXTURE.read_text()))

    fmp.fetch_equity(["MSFT:px", "MSFT:cap"], "fmp-key", http_get=spy_get)
    assert calls == ["MSFT"]
