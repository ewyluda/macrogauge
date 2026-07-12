import math
from pathlib import Path

from pipeline import basket
from pipeline.dates import next_month
from pipeline.engine import outlook
from pipeline.publish import outlook as outlook_json, validate
from pipeline.store import vintage


def _gauge_result(component_overrides=None):
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
    component_dicts = {
        c.code: {"weight": c.weight, "daily_index": dict(levels),
                 "last_obs": "2025-01-15"}
        for c in components
    }
    for code, patch in (component_overrides or {}).items():
        component_dicts[code].update(patch)
    return {"variants": {"gauge": {
        "as_of": "2025-01-15",
        "index": dict(levels),
        "components": component_dicts,
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


def test_trailing_median_stops_at_last_real_observation(tmp_path):
    """A lagging component's forward-filled months are fabricated 0.0% changes;
    they must never enter the trailing median (the gauge's like-month rule)."""
    conn = vintage.load(tmp_path / "store")

    # medical goes stale after 2024-03: the daily grid forward-fills the level,
    # so months 2024-04..2024-12 would contribute nine phantom zeros — enough
    # to force the 12-month median to exactly 0.0 without the truncation.
    base = _gauge_result()
    shared = base["variants"]["gauge"]["components"]["medical"]["daily_index"]
    frozen_level = shared["2024-03-01"]
    frozen = {date: (value if date <= "2024-03-01" else frozen_level)
              for date, value in shared.items()}
    result = outlook.run(conn, _gauge_result(component_overrides={
        "medical": {"daily_index": frozen, "last_obs": "2024-03-31"}}))

    expected = outlook._median_mom(
        outlook._month_values(frozen.items(), "2024-03"), 12)
    assert expected > 0
    medical = result["component_paths"]["medical"]
    assert medical[0]["mom_pct"] == round(expected, 4)
    assert all(row["mom_pct"] != 0.0 for row in medical)


def test_component_trend_is_capped_at_config_annual_rate(tmp_path):
    """A spiky NSA window (winter utility gas) must not be annualized into an
    implausible year-long path: the base rate is capped at ±cap %/yr."""
    conn = vintage.load(tmp_path / "store")

    month, level, explosive = "2021-01-01", 100.0, {}
    for _ in range(49):
        explosive[month] = level
        level *= 1.08  # +8%/mo compounds to ~+152%/yr, far beyond the cap
        month = next_month(month)
    result = outlook.run(conn, _gauge_result(component_overrides={
        "electricity": {"daily_index": explosive, "last_obs": "2025-01-01"}}))

    cap_monthly = outlook._monthly_from_annual(20.0)
    assert result["component_paths"]["electricity"][0]["mom_pct"] == round(cap_monthly, 4)


def test_empty_trend_window_falls_back_to_neutral_not_frozen(tmp_path):
    """No computable real change means the neutral baseline drift — a fully
    stale source must not converge to a hard 0.0%/mo (frozen prices) path."""
    conn = vintage.load(tmp_path / "store")

    result = outlook.run(conn, _gauge_result(component_overrides={
        "used_vehicles": {"last_obs": "2021-01-31"}}))

    neutral = outlook._monthly_from_annual(2.0)
    assert result["component_paths"]["used_vehicles"][0]["mom_pct"] == round(neutral, 4)


def test_fuel_label_reflects_series_actually_used(tmp_path):
    """The blend label must describe the composition that produced the number:
    with only WTI in the store, the receipt must not claim a 60/40 blend."""
    conn = vintage.load(tmp_path / "store")
    _insert(conn, "fmp_wti", [("2024-10-01", 100.0), ("2024-12-01", 110.0)])

    result = outlook.run(conn, _gauge_result())
    fuel = result["drivers"][0]
    assert fuel["name"] == "Fuel futures (WTI 100%, 2mo)"
    assert fuel["status"] == "partial"
    assert fuel["sources"] == ["fmp_wti"]
    assert fuel["effect"] == "85% pass-through over 2 months, then flat"

    conn_full = vintage.load(tmp_path / "store2")
    _seed_forward_drivers(conn_full)
    both = outlook.run(conn_full, _gauge_result())
    assert both["drivers"][0]["name"] == "Fuel futures (RBOB 60% / WTI 40%, 2mo)"
    assert both["drivers"][0]["status"] == "live"


def test_stale_driver_series_are_gated_to_fallback(tmp_path):
    """A frozen source's months-old move must not be re-applied as a fresh
    forward shock with status 'live' — gate on the registry's staleness limit.
    An ungated leg of a blend renormalizes, and the label follows."""
    conn = vintage.load(tmp_path / "store")
    _seed_forward_drivers(conn)  # every driver series ends 2024-12-01

    result = outlook.run(conn, _gauge_result(),
                         staleness={"manheim_uvvi_m": 45, "fmp_rbob": 7},
                         today="2025-06-30")  # ~200 days past the last obs

    drivers = {d["key"]: d for d in result["drivers"]}
    assert drivers["used_vehicles"]["status"] == "fallback"
    assert drivers["used_vehicles"]["value"] is None
    # fmp_rbob gated out; fmp_wti carries no limit -> treated fresh -> the
    # blend renormalizes to WTI-only and the receipt says so
    assert drivers["fuel"]["status"] == "partial"
    assert drivers["fuel"]["sources"] == ["fmp_wti"]
    assert drivers["fuel"]["name"] == "Fuel futures (WTI 100%, 2mo)"


def test_outlook_writer_matches_schema(tmp_path):
    conn = vintage.load(tmp_path / "store")
    result = outlook.run(conn, _gauge_result())
    path = outlook_json.write(result, tmp_path / "out", "2025-01-15T12:00:00Z")
    validate.validate_file(
        path,
        Path(__file__).parent.parent / "schemas" / "outlook.schema.json",
    )
