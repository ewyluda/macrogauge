import pytest

from pipeline.engine import signals
from pipeline.engine.nowcast import models
from pipeline.engine.nowcast.models import (build_latest, cpi_nowcast, ensemble,
                                            nfp_nowcast, pce_bridge)
from pipeline.models import Observation
from pipeline.store import vintage

TREND_CONFIG = {"baseline_annual_pct": 2.0, "trailing_median_months": 12,
                "component_trend_annual_cap_pct": 20.0}


def _sticky_gauge(code="medical", monthly_pct=0.3, last="2026-05-28"):
    daily, level = {}, 100.0
    months = [f"2025-{m:02d}" for m in range(1, 13)] + [f"2026-{m:02d}" for m in range(1, 6)]
    for i, m in enumerate(months):
        if i:
            level *= 1 + monthly_pct / 100
        daily[f"{m}-28"] = level
    return {"variants": {"gauge": {
        "as_of": "2026-06-20", "yoy": {"2026-06-20": 3.0},
        "components": {code: {"weight": 1.0, "daily_index": daily,
                              "last_obs": last}}}}}


def test_cpi_nowcast_clamps_window_to_target_month():
    gauge_result = {"variants": {"gauge": {
        "as_of": "2026-07-10",
        "yoy": {"2026-07-10": 3.1},
        "components": {"fuel": {"weight": 1.0, "last_obs": "2026-07-10",
                                "daily_index": {
            "2026-05-01": 100.0, "2026-06-30": 102.0, "2026-07-10": 110.0}}}}}}
    result = cpi_nowcast(gauge_result, "2026-06")
    # June's MoM ends at Jun-30; July's slide must not leak into the June print.
    assert result["mom_pct"] == 2.0
    assert result["components"][0]["mom_pct"] == 2.0


def test_measured_move_is_month_average_not_first_of_prior_month():
    # Dense daily grid: June days 1-15 at 100, days 16-30 at 110 (mean 105);
    # July days 1-10 flat at 105. Month-average move is exactly 0.0. The old
    # point-to-point window anchored at Jun-01 published +5% — a ~6-week
    # change sold as a monthly move (the 2026-07 gasoline bug).
    daily = {f"2026-06-{d:02d}": (100.0 if d <= 15 else 110.0) for d in range(1, 31)}
    daily.update({f"2026-07-{d:02d}": 105.0 for d in range(1, 11)})
    gauge_result = {"variants": {"gauge": {
        "as_of": "2026-07-10", "yoy": {"2026-07-10": 3.1},
        "components": {"fuel": {"weight": 1.0, "last_obs": "2026-07-10",
                                "daily_index": daily}}}}}
    result = cpi_nowcast(gauge_result, "2026-07", config=TREND_CONFIG)
    row = result["components"][0]
    assert row["basis"] == "measured"
    assert row["mom_pct"] == 0.0


def test_nfp_ols_actually_fits_momentum_coefficient():
    # Payroll changes double each month, so next_change = (24/7) × momentum
    # exactly, with zero intercept — a real fit must recover both.
    level, payroll = 150000.0, []
    for m in range(1, 13):
        level += 2 ** m
        payroll.append((f"2024-{m:02d}-01", level))
    result = nfp_nowcast(payroll, [])
    assert abs(result["parameters"]["b"] - 24 / 7) < 1e-6
    assert abs(result["parameters"]["a"]) < 1e-6


def test_nfp_claims_delta_converted_to_thousands():
    level, payroll = 150000.0, []
    for m in range(1, 13):
        level += 100
        payroll.append((f"2024-{m:02d}-01", level))
    flat = [(f"2024-02-{d:02d}", 200000.0) for d in range(1, 9)]
    risen = [(d, v + (8000 if i >= 4 else 0)) for i, (d, v) in enumerate(flat)]
    calm = nfp_nowcast(payroll, flat)
    stressed = nfp_nowcast(payroll, risen)
    # +8,000 persons on the ICSA 4-week average is 8k jobs of drag, not 8M.
    assert calm["change_thousands"] - stressed["change_thousands"] == 8


def test_pce_bridge_fits_linear_relationship():
    cpi, pce = [], []
    cpi_level = pce_level = 100.0
    for year in (2024, 2025):
        for month in range(1, 13):
            key = f"{year}-{month:02d}-01"
            move = 0.1 + month / 100
            cpi_level *= 1 + move / 100
            pce_level *= 1 + (0.05 + 0.8 * move) / 100
            cpi.append((key, cpi_level)); pce.append((key, pce_level))
    result = pce_bridge(0.3, cpi, pce)
    assert abs(result["mom_pct"] - 0.29) < 0.02
    assert result["parameters"]["observations"] >= 20


def test_nfp_model_returns_transparent_inputs_and_coefficients():
    payroll = [(f"2024-{m:02d}-01", 150000 + m * m * 10) for m in range(1, 13)]
    claims = [(f"2024-01-{d:02d}", 200 + d) for d in range(1, 13)]
    result = nfp_nowcast(payroll, claims)
    assert isinstance(result["change_thousands"], int)
    assert set(result["parameters"]) == {"a", "b", "c", "window_months"}


def test_ensemble_omits_missing_benchmarks_and_normalizes_weights():
    result = ensemble({"ours": 0.2, "cleveland": None, "kalshi": 0.3},
                      {"ours": 0.1, "kalshi": 0.2})
    assert set(result["weights"]) == {"ours", "kalshi"}
    assert abs(sum(result["weights"].values()) - 1) < 1e-3


def test_nfp_nowcast_reference_month_is_month_after_latest_payroll():
    payroll = [(f"2025-{m:02d}-01", 150000.0 + 10 * m) for m in range(1, 13)]
    result = models.nfp_nowcast(payroll, [])
    assert result["reference_month"] == "2026-01"  # Dec released -> forecasting Jan


def test_build_latest_degrades_instead_of_raising_when_calendar_exhausted():
    # config/release_calendar.json's last entry is 2026-12-10 — every run from
    # 2026-12-11 onward hits next_release=None until the next calendar refresh.
    # This must degrade the nowcast, never raise (a nowcast failure can't take
    # composites or gauge QA down with it).
    result = build_latest(conn=None, gauge_result={}, next_release=None,
                          benchmarks={"cleveland": 0.2})
    assert result["release_date"] is None
    assert result["reference_month"] is None
    assert result["cpi"]["status"] == "unavailable"
    assert result["cpi"]["mom_pct"] is None
    assert result["cpi"]["parameters"] == {}
    assert result["pce"]["status"] == "unavailable"
    assert result["nfp"] is None
    assert result["benchmarks"] == {"cleveland": 0.2}
    assert result["ensemble"] == {"value": None, "weights": {}}


def test_cpi_nowcast_publishes_no_phantom_parameters():
    # fuel_beta / rent_lag_months / rent_w were never used by the model —
    # publishing them was dishonest methodology (2026-07-11 review).
    assert not hasattr(models, "CPI_PARAMS")


def test_modeled_component_uses_trailing_median_not_zero():
    # medical's last real obs is May; June has only forward-fill. The old
    # model published 0.00 -- the systematic downward bias behind todo #4.
    result = cpi_nowcast(_sticky_gauge(), "2026-06", config=TREND_CONFIG)
    row = result["components"][0]
    assert row["basis"] == "trend"
    assert row["mom_pct"] == pytest.approx(0.3, abs=0.02)
    assert result["mom_pct"] == pytest.approx(0.3, abs=0.02)
    assert "driver_mom_pct" not in row


def test_modeled_trend_is_capped_and_falls_back_to_neutral():
    # +8%/mo history slams into the ±20%/yr cap (≈ +1.531%/mo)...
    hot = cpi_nowcast(_sticky_gauge(monthly_pct=8.0), "2026-06", config=TREND_CONFIG)
    from pipeline.engine import signals
    assert hot["components"][0]["mom_pct"] == pytest.approx(
        signals.monthly_from_annual(20.0), abs=1e-4)
    # ...and a single-observation history has no computable change: neutral
    # 2%/yr baseline, not frozen prices.
    lone = _sticky_gauge()
    comp = lone["variants"]["gauge"]["components"]["medical"]
    comp["daily_index"] = {"2026-05-28": 100.0}
    assert cpi_nowcast(lone, "2026-06", config=TREND_CONFIG)["components"][0][
        "mom_pct"] == pytest.approx(signals.monthly_from_annual(2.0), abs=1e-4)


def test_measured_component_math_unchanged_and_labeled():
    gauge_result = {"variants": {"gauge": {
        "as_of": "2026-07-10", "yoy": {"2026-07-10": 3.1},
        "components": {"fuel": {"weight": 1.0, "last_obs": "2026-07-10",
                                "daily_index": {"2026-05-01": 100.0,
                                                "2026-06-30": 102.0,
                                                "2026-07-10": 110.0}}}}}}
    result = cpi_nowcast(gauge_result, "2026-06", config=TREND_CONFIG)
    assert result["components"][0]["basis"] == "measured"
    assert result["components"][0]["mom_pct"] == 2.0  # same clamp as before


AG_SERIES = ["fmp_corn", "fmp_wheat", "fmp_soybeans", "fmp_soybean_oil",
             "fmp_coffee", "fmp_sugar", "fmp_cocoa", "fmp_live_cattle"]
DRIVER_CONFIG = {**TREND_CONFIG,
                 "food_home": {"lookback_months": 3, "pass_through": 0.15,
                               "horizon_months": 4, "series": AG_SERIES},
                 "used_vehicles": {"series": "manheim_uvvi_m",
                                   "lookback_months": 3, "pass_through": 0.7,
                                   "horizon_months": 3}}


def _seed(store_dir, code, rows):
    vintage.append([Observation(series_code=code, obs_date=d, value=v,
                                vintage_date="2026-06-15", source="TEST",
                                route="FIXTURE")
                    for d, v in rows], store_dir)


def test_food_home_gets_one_month_futures_slice(tmp_path):
    for code in AG_SERIES:  # +3% over the 3-month lookback
        _seed(tmp_path, code, [("2026-03-10", 100.0), ("2026-06-10", 103.0)])
    conn = vintage.load(tmp_path)
    result = cpi_nowcast(_sticky_gauge(code="food_home"), "2026-06",
                         conn=conn, config=DRIVER_CONFIG)
    row = result["components"][0]
    assert row["basis"] == "trend+driver"
    expected_slice = signals.distributed_return(3.0 * 0.15, 4)
    assert row["driver_mom_pct"] == pytest.approx(expected_slice, abs=1e-4)
    assert row["mom_pct"] == pytest.approx(0.3 + expected_slice, abs=0.03)


def test_stale_futures_degrade_food_home_to_trend_only(tmp_path):
    for code in AG_SERIES:
        _seed(tmp_path, code, [("2026-01-10", 100.0), ("2026-04-10", 103.0)])
    conn = vintage.load(tmp_path)
    result = cpi_nowcast(_sticky_gauge(code="food_home"), "2026-06", conn=conn,
                         config=DRIVER_CONFIG,
                         staleness={code: 7 for code in AG_SERIES},
                         today="2026-06-20")  # last obs 71 days old, limit 7
    row = result["components"][0]
    assert row["basis"] == "trend"
    assert "driver_mom_pct" not in row


def test_lagging_used_vehicles_gets_manheim_slice(tmp_path):
    _seed(tmp_path, "manheim_uvvi_m", [("2026-02-01", 200.0), ("2026-05-01", 206.0)])
    conn = vintage.load(tmp_path)
    result = cpi_nowcast(_sticky_gauge(code="used_vehicles"), "2026-06",
                         conn=conn, config=DRIVER_CONFIG)
    row = result["components"][0]
    assert row["basis"] == "trend+driver"
    assert row["driver_mom_pct"] == pytest.approx(
        signals.distributed_return(3.0 * 0.7, 3), abs=1e-4)


def test_energy_components_stay_trend_only_with_full_store(tmp_path):
    _seed(tmp_path, "fmp_natgas", [("2026-03-10", 100.0), ("2026-06-10", 112.0)])
    conn = vintage.load(tmp_path)
    for code in ("nat_gas", "electricity"):
        row = cpi_nowcast(_sticky_gauge(code=code), "2026-06", conn=conn,
                          config=DRIVER_CONFIG)["components"][0]
        assert row["basis"] == "trend"  # outlook says pass-through starts month 2


def test_build_latest_threads_staleness_into_cpi_receipts(tmp_path, monkeypatch):
    captured = {}
    real = models.cpi_nowcast

    def spy(gauge_result, target_month, conn=None, config=None,
            staleness=None, today=None):
        captured.update(staleness=staleness, today=today)
        return real(gauge_result, target_month, conn=conn, config=config,
                    staleness=staleness, today=today)

    monkeypatch.setattr(models, "cpi_nowcast", spy)
    _seed(tmp_path, "CPIAUCNS", [("2026-04-01", 320.0), ("2026-05-01", 321.0)])
    _seed(tmp_path, "PCEPI", [("2026-04-01", 126.0), ("2026-05-01", 126.2)])
    _seed(tmp_path, "PAYEMS", [(f"2026-{m:02d}-01", 159000.0 + m) for m in range(1, 6)])
    _seed(tmp_path, "ICSA", [(f"2026-05-{d:02d}", 220000.0) for d in range(1, 9)])
    conn = vintage.load(tmp_path)
    result = build_latest(conn, _sticky_gauge(), {"date": "2026-07-14",
                                                  "reference_month": "2026-06"},
                          staleness={"fmp_corn": 30}, today="2026-06-20")
    assert captured == {"staleness": {"fmp_corn": 30}, "today": "2026-06-20"}
    assert result["cpi"]["components"][0]["basis"] in ("trend", "trend+driver")
