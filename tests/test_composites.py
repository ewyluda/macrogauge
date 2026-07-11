import json
from pathlib import Path

from pipeline.engine.composites import (heat_check, latest_z, momentum,
                                        recession_composite, stress_index)

CONFIG = Path(__file__).parent.parent / "config" / "composites.json"


def test_momentum_diff_mode_keeps_sign_on_negative_series():
    rows = [("2026-01-01", -0.5), ("2026-02-01", -0.25)]
    assert momentum(rows, periods=1, percent=False) == [("2026-02-01", 0.25)]


def test_momentum_percent_skips_non_positive_priors():
    rows = [("d1", -0.1), ("d2", 0.0), ("d3", 200.0), ("d4", 300.0)]
    assert momentum(rows, periods=1) == [("d4", 50.0)]


def test_latest_z_diff_mode():
    rows = [(f"2026-{m:02d}-01", v) for m, v in
            enumerate([-0.5, -0.4, -0.2, 0.1, 0.5], start=1)]
    result = latest_z(rows, periods=1, direction=1, percent=False)
    assert result["momentum"] == 0.4
    assert result["z"] > 0


def test_heatcheck_config_uses_diff_mode_for_rates_and_spreads():
    cfg = json.loads(CONFIG.read_text())["heatcheck"]
    by_code = {item["code"]: item for item in cfg["indicators"]}
    for code in ("T10Y2Y", "T5YIE", "FEDFUNDS", "pmms_30yr", "UNRATE"):
        assert by_code[code].get("mode") == "diff", code
    assert by_code["T10Y2Y"]["periods"] == 63  # daily series ≈ 3 months
    assert by_code["ICSA"]["periods"] == 13    # weekly series ≈ 3 months


def test_latest_z_signs_and_clamps_momentum():
    rows, value = [], 100.0
    for month in range(1, 10):
        value *= 1 + month * month / 100
        rows.append((f"2026-{month:02d}-01", value))
    result = latest_z(rows, periods=1, direction=-1)
    assert -2.5 <= result["z"] < 0
    assert result["as_of"] == "2026-09-01"


def test_heat_check_renormalizes_available_groups():
    result = heat_check([
        {"code": "a", "group": "prices", "z": 1.0},
        {"code": "b", "group": "real", "z": -1.0}],
        {"prices": 25, "real": 25, "housing": 50})
    assert result["score"] == 0
    assert result["coverage_pct"] == 50


def test_stress_index_direction_adjusts_and_weights():
    result = stress_index([
        {"code": "bad", "value": 4, "history": [1, 2, 3, 4], "direction": 1, "weight": 20},
        {"code": "good", "value": 4, "history": [1, 2, 3, 4], "direction": -1, "weight": 10}])
    assert result["score"] == 66.7
    assert result["coverage_pct"] == 30


def test_recession_composite_uses_available_signals_only():
    result = recession_composite([
        {"name": "one", "triggered": True}, {"name": "two", "triggered": False},
        {"name": "missing", "triggered": None}])
    assert result["probability_pct"] == 50
    assert result["available"] == 2
