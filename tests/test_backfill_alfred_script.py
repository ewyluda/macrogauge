import json
from pathlib import Path

from pipeline.engine import backtest
from pipeline.store import vintage
from scripts import backfill_alfred

FIXTURE = Path(__file__).parent / "fixtures" / "alfred_cpiaucns.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert params["realtime_start"] == "2016-01-01"
    return FakeResponse(json.loads(FIXTURE.read_text()))


def test_backfill_seeds_walk_forward_backtest(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    # the daily snapshot vintage that made the walk-forward degenerate
    vintage.append([vintage_obs("2025-05-01", 313.6, "2026-07-13")], tmp_path)

    rc = backfill_alfred.main(["--store", str(tmp_path),
                               "--observation-start", "2024-11-01"],
                              http_get=fake_get)
    assert rc == 0
    result = backtest.cpi_walk_forward(vintage.load(tmp_path))
    assert result["summary"]["observations"] > 0
    assert all(row["badge"] == "BT" for row in result["rows"])
    # cutoffs are real pre-release dates, not the snapshot vintage
    assert all(row["cutoff"] < "2026-07-13" for row in result["rows"])

    # re-running is a no-op: identity-deduped, no partition growth
    out_first = capsys.readouterr().out
    assert backfill_alfred.main(["--store", str(tmp_path),
                                 "--observation-start", "2024-11-01"],
                                http_get=fake_get) == 0
    assert "wrote 0" in capsys.readouterr().out
    assert "wrote 0" not in out_first


def test_backfill_requires_api_key(tmp_path, monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    import pytest
    with pytest.raises(SystemExit):
        backfill_alfred.main(["--store", str(tmp_path)], http_get=fake_get)


def vintage_obs(date, value, vint):
    from pipeline.models import Observation
    return Observation(series_code="CPIAUCNS", obs_date=date, value=value,
                       vintage_date=vint, source="FRED", route="API")
