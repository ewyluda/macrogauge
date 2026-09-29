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


def _two_component_gauge():
    # fuel (energy) +10% measured in July; medical trends +0.3%/mo.
    gauge = _sticky_gauge("medical", 0.3, last="2026-05-28")
    daily = {f"2026-06-{d:02d}": 100.0 for d in range(1, 31)}
    daily.update({f"2026-07-{d:02d}": 110.0 for d in range(1, 11)})
    comps = gauge["variants"]["gauge"]["components"]
    comps["medical"]["weight"] = 0.5
    comps["fuel"] = {"weight": 0.5, "last_obs": "2026-07-10", "daily_index": daily}
    gauge["variants"]["gauge"]["as_of"] = "2026-07-10"
    gauge["variants"]["gauge"]["yoy"] = {"2026-07-10": 3.0}
    return gauge


def test_core_nowcast_excludes_food_and_energy_and_renormalizes():
    result = cpi_nowcast(_two_component_gauge(), "2026-07", config=TREND_CONFIG)
    core = result["core"]
    assert core["weight_share"] == 0.5
    medical = [r for r in result["components"] if r["component"] == "medical"][0]
    assert core["mom_nsa_pct"] == round(medical["mom_pct"], 2)
    assert core["basis"] == "NSA"  # no conn -> no seasonal factors


def test_seasonal_mom_uses_last_years_factor_ratio(tmp_path):
    rows = [Observation("CPIAUCNS", "2025-06-01", 100.0, "2025-07-15", "FRED", "API"),
            Observation("CPIAUCNS", "2025-07-01", 100.0, "2025-08-12", "FRED", "API"),
            Observation("CPIAUCSL", "2025-06-01", 100.0, "2025-07-15", "FRED", "API"),
            Observation("CPIAUCSL", "2025-07-01", 100.2, "2025-08-12", "FRED", "API")]
    vintage.append(rows, tmp_path)
    conn = vintage.load(tmp_path)
    # NSA flat July; last year's factors say July SA runs 0.2% above NSA vs June
    assert models.seasonal_mom(0.0, conn, "2026-07-01") == pytest.approx(0.2)
    assert models.seasonal_mom(0.0, conn, "2026-09-01") is None  # no factors


def test_kalshi_core_ladder_writes_its_own_series_code():
    from pipeline.connectors import kalshi
    assert kalshi.SERIES_CODES["KXCPICORE"] == "kalshi_core_cpi_mom"


# --- PCE keyed to its own calendar + PPI bridge (backlog #3, 2026-09-28) ---

def _levels(months, moves, start=100.0):
    out, level = [], start
    for m, mv in zip(months, moves):
        level *= 1 + mv / 100
        out.append((m, level))
    return out


def _months(n, start_year=2019):
    return [f"{start_year + i // 12}-{i % 12 + 1:02d}-01" for i in range(n)]


def _ppi_world(n=72, pce_on_ppi=0.2):
    """PCE MoM = 0.05 + 0.6*CPI + pce_on_ppi*hospital PPI (deterministic,
    non-collinear drivers) — the PPI bridge must recover the hospital beta."""
    months = _months(n)
    cpi_mv = [0.2 + 0.1 * ((i * 7) % 5 - 2) / 2 for i in range(n)]
    hosp = [0.3 * ((i * 3) % 7 - 3) / 3 for i in range(n)]
    other = {c: [0.1 * ((i * k) % 4 - 1.5) + 0.01 * ((i * (k + 1)) % 3) for i in range(n)]
             for k, c in zip((2, 5, 11), ("ppi_pce_airline", "ppi_pce_physician",
                                          "ppi_pce_portfolio"))}
    pce_mv = [0.05 + 0.6 * c + pce_on_ppi * h for c, h in zip(cpi_mv, hosp)]
    ppi = {"ppi_pce_hospital": _levels(months, hosp),
           **{c: _levels(months, v) for c, v in other.items()}}
    return months, _levels(months, cpi_mv), _levels(months, pce_mv), ppi


def test_ppi_bridge_recovers_ppi_beta_and_publishes_coefficients():
    months, cpi, pce, ppi = _ppi_world()
    target = months[-1][:7]
    result = models.pce_ppi_bridge(0.3, target, cpi[:-1], pce[:-1], ppi)
    assert result["bridge"] == "cpi+ppi"
    p = result["parameters"]
    assert p["ppi_betas"]["ppi_pce_hospital"] == pytest.approx(0.2, abs=1e-3)
    assert p["cpi_beta"] == pytest.approx(0.6, abs=1e-3)
    assert p["oos_mae_cpi_ppi_pp"] < p["oos_mae_cpi_only_pp"]
    hosp = ppi["ppi_pce_hospital"]
    hosp_mom = (hosp[-1][1] / hosp[-2][1] - 1) * 100
    assert result["mom_pct"] == pytest.approx(0.05 + 0.6 * 0.3 + 0.2 * hosp_mom, abs=0.01)
    assert p["ppi_inputs_mom_pct"]["ppi_pce_hospital"] == pytest.approx(hosp_mom, abs=1e-4)
    assert p["window_months"] == models.PPI_WINDOW


def test_ppi_bridge_falls_back_to_cpi_only_with_reason():
    months, cpi, pce, ppi = _ppi_world()
    target = months[-1][:7]
    unprinted = {c: rows[:-1] for c, rows in ppi.items()}  # target PPI not out yet
    r = models.pce_ppi_bridge(0.3, target, cpi[:-1], pce[:-1], unprinted)
    assert r["bridge"] == "cpi" and "not printed yet" in r["bridge_note"]
    assert r["mom_pct"] == models.pce_bridge(0.3, cpi[:-1], pce[:-1])["mom_pct"]
    short = {c: rows[-20:] for c, rows in ppi.items()}
    r = models.pce_ppi_bridge(0.3, target, cpi[:-1], pce[:-1], short)
    assert r["bridge"] == "cpi" and "< 36 required" in r["bridge_note"]
    partial = {c: v for c, v in ppi.items() if c != "ppi_pce_hospital"}
    r = models.pce_ppi_bridge(0.3, target, cpi[:-1], pce[:-1], partial)
    assert r["bridge"] == "cpi" and r["bridge_note"] == "PPI inputs not in the store"


def test_ppi_bridge_gate_follows_the_published_out_of_sample_maes():
    # PCE ignores the PPIs (plus noise): whichever bridge publishes, the
    # choice must agree with the two walk-forward MAEs it publishes.
    months, cpi, pce, ppi = _ppi_world(pce_on_ppi=0.0)
    noisy = [(m, v * (1 + 0.0004 * ((i * 13) % 9 - 4))) for i, (m, v) in enumerate(pce)]
    r = models.pce_ppi_bridge(0.3, months[-1][:7], cpi[:-1], noisy[:-1], ppi)
    p = r["parameters"]
    if r["bridge"] == "cpi":
        assert "did not beat" in r["bridge_note"]
        assert p["oos_mae_cpi_ppi_pp"] >= p["oos_mae_cpi_only_pp"]
    else:
        assert p["oos_mae_cpi_ppi_pp"] < p["oos_mae_cpi_only_pp"]


def _pce_store(tmp_path, cpi_through="2026-08-01"):
    ms = [m for m in _months(48, 2023) if m <= "2026-09-01"]
    _seed(tmp_path, "CPIAUCSL", [r for r in _levels(ms, [0.25] * len(ms)) if r[0] <= cpi_through])
    _seed(tmp_path, "CPILFESL", [r for r in _levels(ms, [0.28] * len(ms)) if r[0] <= cpi_through])
    pce = [r for r in _levels(ms, [0.2] * len(ms)) if r[0] <= "2026-07-01"]
    _seed(tmp_path, "PCEPI", pce)
    _seed(tmp_path, "PCEPILFE", pce)
    return vintage.load(tmp_path)


CPI_SEPT = {"mom_pct": 0.42, "mom_nsa_pct": 0.38, "basis": "SA", "as_of": "2026-09-28",
            "core": {"mom_pct": 0.10, "mom_nsa_pct": 0.14, "basis": "SA"}}


def test_pce_nowcast_uses_actual_cpi_once_that_month_printed(tmp_path):
    # 2026-09-28: CPI nowcast targets Sept, PCE's next release (09-30) is Aug
    # and Aug CPI printed 09-11 -> the bridge reads the ACTUAL Aug SA CPI.
    conn = _pce_store(tmp_path, cpi_through="2026-08-01")
    r = models.pce_nowcast(conn, CPI_SEPT, "2026-08", "2026-09-30", "2026-09")
    assert r["reference_month"] == "2026-08" and r["release_date"] == "2026-09-30"
    assert r["cpi_input"]["source"] == "actual" and r["cpi_input"]["series"] == "CPIAUCSL"
    assert r["cpi_input"]["mom_pct"] == pytest.approx(0.25, abs=1e-4)
    assert r["core"]["cpi_input"]["source"] == "actual"
    assert r["core"]["cpi_input"]["series"] == "CPILFESL"
    assert r["status"] == "live" and r["core"]["status"] == "live"


def test_pce_nowcast_uses_sa_cpi_nowcast_when_month_not_printed(tmp_path):
    # 2026-10-01: PCE targets Sept (release 10-29); Sept CPI is out 10-14.
    conn = _pce_store(tmp_path, cpi_through="2026-08-01")
    r = models.pce_nowcast(conn, CPI_SEPT, "2026-09", "2026-10-29", "2026-09")
    assert r["cpi_input"] == {"source": "nowcast", "series": "CPIAUCSL", "mom_pct": 0.42}
    assert r["core"]["cpi_input"] == {"source": "nowcast", "series": "CPILFESL",
                                      "mom_pct": 0.1}


def test_pce_nowcast_unavailable_without_actual_or_same_month_nowcast(tmp_path):
    # PCE month whose CPI never printed (2025-10) and isn't the CPI target:
    # no guess off another month's nowcast.
    conn = _pce_store(tmp_path, cpi_through="2026-07-01")
    r = models.pce_nowcast(conn, CPI_SEPT, "2026-08", "2026-09-30", "2026-09")
    assert r["status"] == "unavailable" and r["mom_pct"] is None
    assert r["core"]["status"] == "unavailable"


def test_build_latest_keys_pce_to_its_own_release(tmp_path):
    _pce_store(tmp_path, cpi_through="2026-08-01")
    _seed(tmp_path, "PAYEMS", [(f"2026-{m:02d}-01", 159000.0 + m) for m in range(1, 9)])
    conn = vintage.load(tmp_path)
    result = build_latest(conn, _sticky_gauge(), {"date": "2026-10-14",
                                                  "reference_month": "2026-09"},
                          pce_release={"date": "2026-09-30", "reference_month": "2026-08"},
                          pce_benchmarks={"cleveland": {"value": 0.35, "as_of": "2026-09-20"}},
                          core_pce_benchmarks={"cleveland": None})
    assert result["reference_month"] == "2026-09"
    assert result["pce"]["reference_month"] == "2026-08"
    assert result["pce"]["release_date"] == "2026-09-30"
    assert result["pce"]["cpi_input"]["source"] == "actual"
    assert result["pce"]["benchmarks"] == {"cleveland": {"value": 0.35, "as_of": "2026-09-20"}}
    assert result["pce"]["core"]["benchmarks"] == {}
