from pipeline.engine.nowcast import models
from pipeline.engine.nowcast.models import (build_latest, cpi_nowcast, ensemble,
                                            nfp_nowcast, pce_bridge)


def test_cpi_nowcast_clamps_window_to_target_month():
    gauge_result = {"variants": {"gauge": {
        "as_of": "2026-07-10",
        "yoy": {"2026-07-10": 3.1},
        "components": {"fuel": {"weight": 1.0, "daily_index": {
            "2026-05-01": 100.0, "2026-06-30": 102.0, "2026-07-10": 110.0}}}}}}
    result = cpi_nowcast(gauge_result, "2026-06")
    # June's MoM ends at Jun-30; July's slide must not leak into the June print.
    assert result["mom_pct"] == 2.0
    assert result["components"][0]["mom_pct"] == 2.0


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
    result = ensemble({"ours": 0.2, "cleveland": None, "street": 0.3},
                      {"ours": 0.1, "street": 0.2})
    assert set(result["weights"]) == {"ours", "street"}
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
