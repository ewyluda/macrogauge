from pipeline.engine.composites import (heat_check, latest_z, recession_composite,
                                        stress_index)


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
