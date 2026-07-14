import json
import math
from pathlib import Path

import pytest

from pipeline import basket, registry
from pipeline.dates import next_month
from pipeline.engine import outlook, signals
from pipeline.models import Observation
from pipeline.publish import outlook as outlook_json, validate
from pipeline.store import vintage


def _gauge_result(component_overrides=None, start="2021-01-01", months=49):
    _, components = basket.load_basket()
    month = start
    level = 100.0
    levels = {}
    for i in range(months):
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


def _insert(store_dir, code, rows):
    # Seed through the real store API so these fixtures track the production
    # row shape (the row-evolution policy) instead of a hand-rolled INSERT.
    vintage.append([Observation(series_code=code, obs_date=date, value=value,
                                vintage_date="2025-01-10", source="TEST", route="FIXTURE")
                    for date, value in rows], store_dir)


def _seed_forward_drivers(store_dir):
    energy = [("2024-10-01", 100.0), ("2024-12-01", 110.0)]
    for code in ("fmp_rbob", "fmp_wti"):
        _insert(store_dir, code, energy)
    for code in ("fmp_corn", "fmp_wheat", "fmp_soybeans", "fmp_soybean_oil",
                 "fmp_coffee", "fmp_sugar", "fmp_cocoa", "fmp_live_cattle"):
        _insert(store_dir, code, [("2024-09-01", 100.0), ("2024-12-01", 103.0)])
    _insert(store_dir, "fmp_natgas", [("2024-09-01", 100.0), ("2024-12-01", 112.0)])
    _insert(store_dir, "manheim_uvvi_m", [("2024-09-01", 100.0), ("2024-12-01", 106.0)])
    _insert(store_dir, "FRBATLWGT3MMAUMHWGO", [("2024-12-01", 3.5)])
    for code in ("PPIACO", "PCUOMFGOMFG", "IREXPETCOM"):
        _insert(store_dir, code, [("2024-09-01", 100.0), ("2024-12-01", 101.0)])
    _insert(store_dir, "zori_us", [("2024-12-01", 2000.0)])
    _insert(store_dir, "aptlist_us", [("2024-12-01", 1500.0)])


def test_outlook_rolls_12_months_from_latest_complete_month(tmp_path):
    _seed_forward_drivers(tmp_path / "store")
    conn = vintage.load(tmp_path / "store")

    result = outlook.run(conn, _gauge_result())

    assert result["model"] == "macrogauge_outlook_v1"
    assert result["origin_month"] == "2024-12"
    assert len(result["forecast"]) == 12
    assert result["forecast"][0]["month"] == "2025-01"
    assert result["forecast"][-1]["month"] == "2025-12"
    assert len(result["base_effects_only"]) == 12
    assert result["driver_coverage_pct"] == 87.5  # KBB is the only deliberate fallback


def test_disclosed_fuel_pass_through_and_band_math(tmp_path):
    _seed_forward_drivers(tmp_path / "store")
    conn = vintage.load(tmp_path / "store")
    result = outlook.run(conn, _gauge_result())

    expected = signals.distributed_return(10.0 * 0.85, 2)
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

    expected = signals.median_mom(
        signals.month_values(frozen.items(), "2024-03"), 12)
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

    cap_monthly = signals.monthly_from_annual(20.0)
    assert result["component_paths"]["electricity"][0]["mom_pct"] == round(cap_monthly, 4)


def test_empty_trend_window_falls_back_to_neutral_not_frozen(tmp_path):
    """No computable real change means the neutral baseline drift — a fully
    stale source must not converge to a hard 0.0%/mo (frozen prices) path."""
    conn = vintage.load(tmp_path / "store")

    result = outlook.run(conn, _gauge_result(component_overrides={
        "used_vehicles": {"last_obs": "2021-01-31"}}))

    neutral = signals.monthly_from_annual(2.0)
    assert result["component_paths"]["used_vehicles"][0]["mom_pct"] == round(neutral, 4)


def test_fuel_label_reflects_series_actually_used(tmp_path):
    """The blend label must describe the composition that produced the number:
    with only WTI in the store, the receipt must not claim a 60/40 blend."""
    _insert(tmp_path / "store", "fmp_wti", [("2024-10-01", 100.0), ("2024-12-01", 110.0)])
    conn = vintage.load(tmp_path / "store")

    result = outlook.run(conn, _gauge_result())
    fuel = result["drivers"][0]
    assert fuel["name"] == "Fuel futures (WTI 100%, 2mo)"
    assert fuel["status"] == "partial"
    assert fuel["sources"] == ["fmp_wti"]
    assert fuel["effect"] == "85% pass-through over 2 months, then flat"

    _seed_forward_drivers(tmp_path / "store2")
    conn_full = vintage.load(tmp_path / "store2")
    both = outlook.run(conn_full, _gauge_result())
    assert both["drivers"][0]["name"] == "Fuel futures (RBOB 60% / WTI 40%, 2mo)"
    assert both["drivers"][0]["status"] == "live"


def test_stale_driver_series_are_gated_to_fallback(tmp_path):
    """A frozen source's months-old move must not be re-applied as a fresh
    forward shock with status 'live' — gate on the registry's staleness limit.
    An ungated leg of a blend renormalizes, and the label follows."""
    _seed_forward_drivers(tmp_path / "store")  # every driver series ends 2024-12-01
    conn = vintage.load(tmp_path / "store")

    _, series = registry.load_registry()
    staleness = {s.code: 100_000 for s in series}  # everything fresh by default
    staleness.update({"manheim_uvvi_m": 45, "fmp_rbob": 7})
    result = outlook.run(conn, _gauge_result(), staleness=staleness,
                         today="2025-06-30")  # ~200 days past the last obs

    drivers = {d["key"]: d for d in result["drivers"]}
    assert drivers["used_vehicles"]["status"] == "fallback"
    assert drivers["used_vehicles"]["value"] is None
    # fmp_rbob gated out; fmp_wti stays within its generous limit -> the
    # blend renormalizes to WTI-only and the receipt says so
    assert drivers["fuel"]["status"] == "partial"
    assert drivers["fuel"]["sources"] == ["fmp_wti"]
    assert drivers["fuel"]["name"] == "Fuel futures (WTI 100%, 2mo)"


def test_pipeline_tilt_is_compounded_monthly_not_divided(tmp_path):
    """The goods-pipeline tilt is an annual pp figure; its monthly form must
    compound ((1+t)^(1/12)-1), matching every other annual→monthly conversion
    in the engine, not a linear t/12."""
    for code in ("PPIACO", "PCUOMFGOMFG", "IREXPETCOM"):
        _insert(tmp_path / "store", code, [("2024-09-01", 100.0), ("2024-12-01", 101.0)])
    conn = vintage.load(tmp_path / "store")

    gauge = _gauge_result()
    result = outlook.run(conn, gauge)

    annual = signals.annualized(1.0, 3)          # each series +1% over the 3mo lookback
    tilt = max(-1.0, min(1.0, (annual - 2.0) * 0.5))
    levels = signals.component_trend_levels(
        gauge["variants"]["gauge"]["components"]["apparel"], "2024-12")
    own = signals.median_mom(levels, 12)         # apparel is goods-only, no other shock
    expected = own + signals.monthly_from_annual(tilt)
    assert result["component_paths"]["apparel"][0]["mom_pct"] == round(expected, 4)


def test_shelter_and_new_vehicle_receipts_follow_config(tmp_path):
    """The shelter rent legs and the new-vehicles trend series are config, not
    code: recomposing the blend must not leave stale hardcoded receipts."""
    cfg = json.loads(outlook.DEFAULT_CONFIG.read_text())
    cfg["shelter"] = {"series": ["zori_us"]}
    cfg["new_vehicles"] = {"trend_source": "kbb_atp"}
    config_path = tmp_path / "outlook.json"
    config_path.write_text(json.dumps(cfg))
    _insert(tmp_path / "store", "zori_us", [("2024-12-01", 2000.0)])
    conn = vintage.load(tmp_path / "store")

    result = outlook.run(conn, _gauge_result(), config_path=config_path)

    drivers = {d["key"]: d for d in result["drivers"]}
    assert drivers["shelter"]["sources"] == ["zori_us"]
    assert "Apartment List" not in drivers["shelter"]["name"]
    assert drivers["new_vehicles"]["sources"] == ["kbb_atp"]


def test_config_series_typo_raises_instead_of_silent_fallback(tmp_path):
    """With registry context available, a typo'd series code in outlook.json
    must fail the run loudly — not degrade to a permanent 'fallback' driver."""
    cfg = json.loads(outlook.DEFAULT_CONFIG.read_text())
    cfg["fuel"]["series"] = {"fmp_rbobb": 0.6, "fmp_wti": 0.4}
    config_path = tmp_path / "outlook.json"
    config_path.write_text(json.dumps(cfg))
    conn = vintage.load(tmp_path / "store")
    _, series = registry.load_registry()
    staleness = {s.code: s.max_staleness_days for s in series}

    with pytest.raises(ValueError, match="unknown series.*fmp_rbobb"):
        outlook.run(conn, _gauge_result(), config_path=config_path,
                    staleness=staleness, today="2025-01-15")


def test_config_component_typo_raises(tmp_path):
    """Component references must exist in the gauge basket — a typo would
    silently drop the wage anchor or pipeline tilt from that component."""
    cfg = json.loads(outlook.DEFAULT_CONFIG.read_text())
    cfg["wages"]["service_components"] = ["food_away", "medcial"]
    config_path = tmp_path / "outlook.json"
    config_path.write_text(json.dumps(cfg))
    conn = vintage.load(tmp_path / "store")

    with pytest.raises(ValueError, match="unknown component.*medcial"):
        outlook.run(conn, _gauge_result(), config_path=config_path)


def test_short_history_raises_named_error_not_indexerror(tmp_path):
    """With <13 complete months there is no actual YoY at all; the engine must
    fail with a diagnosable message, not an IndexError on actual_yoy[-1]."""
    conn = vintage.load(tmp_path / "store")

    with pytest.raises(ValueError, match="outlook: .*13 complete months"):
        outlook.run(conn, _gauge_result(start="2024-01-01", months=12))


def test_fallback_sigma_reports_zero_window(tmp_path):
    """When the volatility window is too short and the configured fallback sigma
    is used, sigma_window_months must say 0 — not the size of the window the
    stdev was never computed over."""
    conn = vintage.load(tmp_path / "store")

    result = outlook.run(conn, _gauge_result(start="2023-06-01", months=19))

    assert result["sigma_monthly_pp"] == 0.35  # volatility_fallback_pp
    assert result["sigma_window_months"] == 0


def test_outlook_writer_matches_schema(tmp_path):
    conn = vintage.load(tmp_path / "store")
    result = outlook.run(conn, _gauge_result())
    path = outlook_json.write(result, tmp_path / "out", "2025-01-15T12:00:00Z")
    validate.validate_file(
        path,
        Path(__file__).parent.parent / "schemas" / "outlook.schema.json",
    )
