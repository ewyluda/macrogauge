"""Injected-HTTP test for the one-shot December-2016 CPI base backfill."""
import pytest

from pipeline.store import vintage
from scripts import backfill_base_dec2016

# The real registry's 14 bases as FRED knows them — the CPI codes are collected
# daily from BLS, and five are FRED aliases a BLS id 400s on (PR #115 review).
FRED_IDS = {"CPIAUCNS", "CUUR0000SAF11", "CUUR0000SEFV", "CPIMEDNS", "CPIAPPNS",
            "CPIRECNS", "CPIEDUNS", "CUUR0000SETA01", "CUUR0000SETA02",
            "CUUR0000SEHA", "CUUR0000SEHC", "CUUR0000SEHF01", "CUUR0000SEHF02",
            "CUUR0000SETB01"}


class FakeResp:
    def __init__(self, payload, status_code=200):
        self._payload, self.status_code = payload, status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"{self.status_code}: series does not exist")

    def json(self):
        return self._payload


def make_get(seen: list, absent=()):
    def fake_get(url, params=None, timeout=None):
        sid = params["series_id"]
        seen.append(sid)
        if sid not in FRED_IDS or sid in absent:
            return FakeResp({}, status_code=400)
        return FakeResp({"observations": [{"date": "2016-12-01", "value": "100.0"},
                                          {"date": "2017-01-01", "value": "101.0"}]})
    return fake_get


def test_backfill_asks_fred_for_its_own_ids_and_stores_every_base(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    assert backfill_base_dec2016.main(["--store", str(tmp_path)], http_get=make_get(seen)) == 0
    assert sorted(seen) == sorted(FRED_IDS)
    conn = vintage.load(tmp_path)
    stored = {c for (c,) in conn.execute(
        "SELECT DISTINCT series_code FROM observations WHERE obs_date = '2016-12-01'")}
    assert len(stored) == 14 and {"CPIAUCNS", "CUUR0000SAM", "CUUR0000SAR"} <= stored
    assert not conn.execute(
        "SELECT 1 FROM observations WHERE obs_date != '2016-12-01'").fetchone()


def test_backfill_writes_nothing_when_one_base_is_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_base_dec2016.main(["--store", str(tmp_path)],
                                   http_get=make_get([], absent={"CPIMEDNS"}))
    assert "CUUR0000SAM" in str(e.value) and "NOTHING written" in str(e.value)
    assert not list((tmp_path / "obs").glob("*.jsonl"))
