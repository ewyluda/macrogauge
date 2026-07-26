"""The backfill must remap FRED ids to registry codes and refuse to append a
partial vintage set. The store is append-only, so a half-loaded basket cannot
be undone -- validation happens BEFORE the write, never after."""
import json
from pathlib import Path

import pytest

from pipeline.models import Observation
from scripts import backfill_dc_vintages as bf


def _obs(code, obs_date, vintage, value=100.0):
    return Observation(series_code=code, obs_date=obs_date, value=value,
                       vintage_date=vintage, source="ALFRED", route="API")


def test_build_series_entries_covers_all_twelve_components():
    entries = bf.build_series_entries()
    assert len(entries) == 12
    # every entry must carry a FRED source_id distinct from its registry code
    assert all(e.source_id != e.code for e in entries)
    assert {"ppi_steel", "ces_constr_ahe"} <= {e.code for e in entries}


def test_coverage_reports_span_and_vintage_count_per_series():
    obs = [_obs("ppi_steel", "2008-01-01", "2015-03-13"),
           _obs("ppi_steel", "2008-01-01", "2016-04-14"),
           _obs("ppi_steel", "2009-01-01", "2015-03-13")]
    cov = bf.coverage(obs)
    assert cov["ppi_steel"] == ("2008-01-01", "2009-01-01", 2)


def test_shortfalls_flags_a_series_that_came_back_with_one_vintage():
    cov = {"ppi_steel": ("2008-01-01", "2026-06-01", 130),
           "ppi_concrete": ("2008-01-01", "2026-06-01", 1)}
    bad = bf.shortfalls(cov, {"ppi_steel", "ppi_concrete"}, min_vintages=50)
    assert bad == ["ppi_concrete"]


def test_shortfalls_flags_a_series_that_is_entirely_missing():
    cov = {"ppi_steel": ("2008-01-01", "2026-06-01", 130)}
    bad = bf.shortfalls(cov, {"ppi_steel", "ppi_concrete"}, min_vintages=50)
    assert bad == ["ppi_concrete"]


def test_main_refuses_to_append_when_any_series_is_short(tmp_path, monkeypatch):
    """The PR #6 trap: fred.fetch tolerates partial failure. A loop over 12
    series reintroduces it, and aggregate.headline intersects component dates,
    so one short series silently truncates the whole index."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, **kw):
        calls["n"] += 1
        sid = params["series_id"]
        # every series returns a healthy vintage set except one
        n = 1 if sid == "WPU1017" else 60
        return _FakeResponse({"observations": [
            {"date": "2008-01-01", "value": "100.0",
             "realtime_start": f"2015-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}"}
            for i in range(n)]})

    store = tmp_path / "store"
    store.mkdir()
    with pytest.raises(SystemExit) as exc:
        bf.main(["--store", str(store)], http_get=fake_get)
    assert "ppi_steel" in str(exc.value)
    assert list((store / "obs").glob("*.jsonl")) == []   # nothing written


def test_main_remaps_fred_ids_to_registry_codes(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    def fake_get(url, params=None, timeout=None, **kw):
        return _FakeResponse({"observations": [
            {"date": "2008-01-01", "value": "100.0",
             "realtime_start": f"2015-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}"}
            for i in range(60)]})

    store = tmp_path / "store"
    store.mkdir()
    assert bf.main(["--store", str(store)], http_get=fake_get) == 0
    rows = [json.loads(line) for p in (store / "obs").glob("*.jsonl")
            for line in p.read_text().splitlines()]
    codes = {r["series_code"] for r in rows}
    assert "ppi_steel" in codes            # registry code
    assert "WPU1017" not in codes          # never the raw FRED id


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload
