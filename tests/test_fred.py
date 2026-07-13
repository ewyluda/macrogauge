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
    assert len(obs) == 6  # the "." row is skipped
    first = obs[0]
    assert (first.series_code, first.obs_date, first.value) == ("CPIAUCNS", "2025-04-01", 312.9)
    assert (first.vintage_date, first.source, first.route) == ("2026-07-07", "FRED", "API")


def test_today_et_format():
    assert len(fred.today_et()) == 10  # YYYY-MM-DD


ALFRED_FIXTURE = Path(__file__).parent / "fixtures" / "alfred_cpiaucns.json"


def fake_get_alfred(url, params=None, timeout=None):
    assert params["series_id"] == "CPIAUCNS"
    assert params["api_key"] == "test-key"
    assert params["file_type"] == "json"
    assert params["observation_start"] == "2024-11-01"
    assert params["realtime_start"] == "2016-01-01"
    assert params["realtime_end"] == "9999-12-31"
    return FakeResponse(json.loads(ALFRED_FIXTURE.read_text()))


def test_fetch_vintages_stamps_each_window_with_its_release_date():
    obs = fred.fetch_vintages("CPIAUCNS", "test-key",
                              observation_start="2024-11-01",
                              http_get=fake_get_alfred)
    assert len(obs) == 9  # the "." row is skipped
    first = obs[0]
    assert (first.series_code, first.obs_date, first.value) == ("CPIAUCNS", "2024-11-01", 310.0)
    assert (first.vintage_date, first.source, first.route) == ("2024-12-11", "ALFRED", "API")
    # a revised obs_date keeps BOTH windows, each under its own vintage
    march = [(o.vintage_date, o.value) for o in obs if o.obs_date == "2025-03-01"]
    assert march == [("2025-04-10", 312.4), ("2025-05-13", 312.5)]
