import json
from pathlib import Path

from pipeline import run_daily
from tests.test_fred import fake_get  # reuses the recorded fixture


def test_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)], http_get=fake_get)
    assert rc == 0
    pulse = json.loads((out / "pulse_lite.json").read_text())
    # fixture: 2026-04-01=320.100 vs 2025-04-01=312.900 -> 2.30%
    assert pulse["official_cpi"]["month"] == "2026-04-01"
    assert pulse["official_cpi"]["yoy_pct"] == 2.3
    qa = json.loads((out / "qa.json").read_text())
    assert qa["total"] == 2
    assert (store / "obs").exists()
