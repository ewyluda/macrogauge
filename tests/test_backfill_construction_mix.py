"""Injected-HTTP test for the one-shot /labor non-craft share backfill."""
import pytest

from scripts import backfill_construction_mix
from pipeline.store import vintage

DEEP = [{"date": "1990-01-01", "value": "5000.0"}, {"date": "2026-08-01", "value": "8300.0"}]
# all-employee earnings really begin 2006-03: that is full coverage, not short
FROM_2006 = [{"date": "2006-03-01", "value": "819.38"}, {"date": "2026-08-01", "value": "1600.0"}]


class FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def make_get(seen: list, shallow=()):
    def fake_get(url, params=None, timeout=None):
        seen.append(params)
        sid = params["series_id"]
        rows = DEEP[1:] if sid in shallow else FROM_2006 if sid == "CES2000000011" else DEEP
        return FakeResp({"observations": list(rows)})
    return fake_get


def test_backfill_fetches_all_four_series_from_1990(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    assert backfill_construction_mix.main(["--store", str(tmp_path)],
                                          http_get=make_get(seen)) == 0
    assert {p["series_id"] for p in seen} == {
        "USCONS", "CES2000000006", "CES2000000011", "CES2000000030"}
    assert all(p["observation_start"] == "1990-01-01" for p in seen)
    conn = vintage.load(tmp_path)
    assert dict(vintage.latest(conn, "CES2000000006"))["1990-01-01"] == 5000.0
    assert dict(vintage.latest(conn, "CES2000000011"))["2006-03-01"] == 819.38


def test_backfill_writes_nothing_when_one_series_is_shallow(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_construction_mix.main(["--store", str(tmp_path)],
                                       http_get=make_get([], shallow={"CES2000000006"}))
    assert "CES2000000006" in str(e.value)
    assert not list((tmp_path / "obs").glob("*.jsonl"))


def test_backfill_writes_nothing_when_earnings_start_after_2006(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_construction_mix.main(["--store", str(tmp_path)],
                                       http_get=make_get([], shallow={"CES2000000030"}))
    assert "CES2000000030" in str(e.value) and "2006-03-01" in str(e.value)
    assert not list((tmp_path / "obs").glob("*.jsonl"))
