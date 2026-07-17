import json
from pathlib import Path

import pytest

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


class ErrorResponse:
    """400/500 response — raise_for_status raises like requests does."""

    def raise_for_status(self):
        import requests
        raise requests.HTTPError("400 Client Error: Bad Request for url")


def _payload():
    return json.loads(FIXTURE.read_text())


def test_fetch_one_bad_series_does_not_kill_the_rest():
    # A single bad id (deleted/typo'd series -> 400) must not take the whole
    # FRED source row down — proven live 2026-07-16 when CUSR0000SEHG01
    # 400'd and all ~100 FRED series went uncollected for a run.
    def get(url, params=None, timeout=None):
        if params["series_id"] == "BADID":
            return ErrorResponse()
        return FakeResponse(_payload())

    obs = fred.fetch(["CPIAUCNS", "BADID", "CPIAUCNS"], "test-key",
                     vintage_date="2026-07-07", http_get=get)
    assert len(obs) == 12  # both good series parsed, bad one skipped
    assert {o.series_code for o in obs} == {"CPIAUCNS"}


def test_fetch_all_series_failing_raises_summary():
    def get(url, params=None, timeout=None):
        return ErrorResponse()

    with pytest.raises(RuntimeError, match=r"FRED: no series loaded.*"
                                           r"CPIAUCNS: HTTPError.*"
                                           r"PCEPI: HTTPError"):
        fred.fetch(["CPIAUCNS", "PCEPI"], "test-key",
                   vintage_date="2026-07-07", http_get=get)


def test_fetch_single_failing_series_reraises_original():
    # With one registered series there is nothing to isolate — surface the
    # real exception (its message names the HTTP status) instead of a
    # one-line summary that hides it.
    import requests
    with pytest.raises(requests.HTTPError, match="400 Client Error"):
        fred.fetch(["CPIAUCNS"], "test-key", vintage_date="2026-07-07",
                   http_get=lambda url, params=None, timeout=None: ErrorResponse())


def test_fetch_throttles_between_series_on_real_network(monkeypatch):
    # FRED caps at 120 req/min and the batch is ~150 series — pace real
    # requests, but only between successive series (never before the first).
    sleeps = []
    monkeypatch.setattr(fred.time, "sleep", sleeps.append)
    monkeypatch.setattr(fred.requests, "get",
                       lambda url, params=None, timeout=None: FakeResponse(_payload()))
    obs = fred.fetch(["CPIAUCNS", "CPIAUCNS", "CPIAUCNS"], "test-key",
                     vintage_date="2026-07-07")
    assert len(obs) == 18
    assert sleeps == [0.45, 0.45]


def test_fetch_never_sleeps_with_injected_http_get(monkeypatch):
    def raiser(_seconds):
        raise AssertionError("throttle must not fire when http_get is injected")

    monkeypatch.setattr(fred.time, "sleep", raiser)
    obs = fred.fetch(["CPIAUCNS", "CPIAUCNS"], "test-key",
                     vintage_date="2026-07-07", http_get=fake_get)
    assert len(obs) == 12


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
