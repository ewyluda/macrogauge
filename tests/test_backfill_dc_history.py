"""Injected-HTTP test for the one-shot DC history backfill."""
import json
from pathlib import Path

from scripts import backfill_dc_history
from pipeline.store import vintage


class FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def make_get(seen: list):
    def fake_get(url, params=None, timeout=None):
        seen.append(params)
        sid = params["series_id"]
        return FakeResp({"observations": [
            {"date": "2007-12-01", "value": "100.0"},
            {"date": "2008-01-01", "value": "101.0"},
            {"date": "2026-06-01", "value": "150.0"},
        ]})
    return fake_get


def test_backfill_writes_internal_codes_not_fred_ids(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    rc = backfill_dc_history.main(
        ["--store", str(tmp_path)], http_get=make_get(seen))
    assert rc == 0

    conn = vintage.load(tmp_path)
    # internal codes, not WPU1017 / CES2000000003
    assert dict(vintage.latest(conn, "ppi_steel"))["2007-12-01"] == 100.0
    assert dict(vintage.latest(conn, "ces_constr_ahe"))["2008-01-01"] == 101.0
    assert vintage.latest(conn, "WPU1017") == []
    assert vintage.latest(conn, "CES2000000003") == []


def test_backfill_requests_deep_observation_start(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert seen, "no HTTP calls made"
    assert all(p["observation_start"] == "2007-12-01" for p in seen)


def test_backfill_covers_all_twelve_build_components(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert {p["series_id"] for p in seen} == {
        "CES2000000003", "PCU23821X23821X", "PCU23822X23822X", "WPU1017",
        "PCU327320327320", "WPU10260314", "WPU102501", "WPU1175", "WPU1174",
        "PCU333611333611", "PCU333415333415", "WPU1141"}


def test_backfill_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    before = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    after = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    assert before == after, "re-running the backfill must be a no-op"
