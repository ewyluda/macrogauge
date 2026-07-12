import math
from pathlib import Path

from pipeline import basket
from pipeline.dates import next_month
from pipeline.engine import outlook
from pipeline.publish import outlook as outlook_json, validate
from pipeline.store import vintage


def _gauge_result():
    _, components = basket.load_basket()
    month = "2021-01-01"
    level = 100.0
    levels = {}
    for i in range(49):
        if i:
            level *= 1 + (0.18 + 0.08 * math.sin(i / 2)) / 100
        levels[month] = level
        month = next_month(month)
    # Partial January must not become the forecast anchor.
    levels["2025-01-15"] = level * 1.25
    return {"variants": {"gauge": {
        "as_of": "2025-01-15",
        "index": dict(levels),
        "components": {
            c.code: {"weight": c.weight, "daily_index": dict(levels)}
            for c in components
        },
    }}}


def _insert(conn, code, rows):
    conn.executemany(
        "INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)",
        [(code, date, value, "2025-01-10", "TEST", "FIXTURE")
         for date, value in rows],
    )
    conn.commit()


def _seed_forward_drivers(conn):
    energy = [("2024-10-01", 100.0), ("2024-12-01", 110.0)]
    for code in ("fmp_rbob", "fmp_wti"):
        _insert(conn, code, energy)
    for code in ("fmp_corn", "fmp_wheat", "fmp_soybeans", "fmp_soybean_oil",
                 "fmp_coffee", "fmp_sugar", "fmp_cocoa", "fmp_live_cattle"):
        _insert(conn, code, [("2024-09-01", 100.0), ("2024-12-01", 103.0)])
    _insert(conn, "fmp_natgas", [("2024-09-01", 100.0), ("2024-12-01", 112.0)])
    _insert(conn, "manheim_uvvi_m", [("2024-09-01", 100.0), ("2024-12-01", 106.0)])
    _insert(conn, "FRBATLWGT3MMAUMHWGO", [("2024-12-01", 3.5)])
    for code in ("PPIACO", "PCUOMFGOMFG", "IREXPETCOM"):
        _insert(conn, code, [("2024-09-01", 100.0), ("2024-12-01", 101.0)])
    _insert(conn, "zori_us", [("2024-12-01", 2000.0)])
    _insert(conn, "aptlist_us", [("2024-12-01", 1500.0)])


def test_outlook_rolls_12_months_from_latest_complete_month(tmp_path):
    conn = vintage.load(tmp_path / "store")
    _seed_forward_drivers(conn)

    result = outlook.run(conn, _gauge_result())

    assert result["model"] == "macrogauge_outlook_v1"
    assert result["origin_month"] == "2024-12"
    assert len(result["forecast"]) == 12
    assert result["forecast"][0]["month"] == "2025-01"
    assert result["forecast"][-1]["month"] == "2025-12"
    assert len(result["base_effects_only"]) == 12
    assert result["driver_coverage_pct"] == 87.5  # KBB is the only deliberate fallback


def test_disclosed_fuel_pass_through_and_band_math(tmp_path):
    conn = vintage.load(tmp_path / "store")
    _seed_forward_drivers(conn)
    result = outlook.run(conn, _gauge_result())

    expected = outlook._distributed_return(10.0 * 0.85, 2)
    fuel = result["component_paths"]["fuel"]
    assert fuel[0]["mom_pct"] == round(expected, 4)
    assert fuel[1]["mom_pct"] == round(expected, 4)
    assert fuel[2]["mom_pct"] == 0.0

    final = result["forecast"][-1]
    expected_width = result["sigma_monthly_pp"] * math.sqrt(12)
    assert abs((final["central_yoy_pct"] - final["low_yoy_pct"]) - expected_width) < 0.02
    assert abs((final["high_yoy_pct"] - final["central_yoy_pct"]) - expected_width) < 0.02


def test_missing_forward_inputs_use_labelled_fallbacks(tmp_path):
    conn = vintage.load(tmp_path / "store")
    result = outlook.run(conn, _gauge_result())

    statuses = {driver["key"]: driver["status"] for driver in result["drivers"]}
    assert statuses["fuel"] == "fallback"
    assert statuses["food_home"] == "fallback"
    assert statuses["nat_gas"] == "fallback"
    assert statuses["new_vehicles"] == "fallback"
    assert result["driver_coverage_pct"] == 0.0
    assert all(math.isfinite(row["central_yoy_pct"]) for row in result["forecast"])


def test_outlook_writer_matches_schema(tmp_path):
    conn = vintage.load(tmp_path / "store")
    result = outlook.run(conn, _gauge_result())
    path = outlook_json.write(result, tmp_path / "out", "2025-01-15T12:00:00Z")
    validate.validate_file(
        path,
        Path(__file__).parent.parent / "schemas" / "outlook.schema.json",
    )
