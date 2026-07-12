from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import phase3
from pipeline.store import vintage


def test_accountability_grades_recorded_pre_release_forecast(tmp_path: Path):
    rows = [
        Observation("CPIAUCNS", "2026-05-01", 100, "2026-06-10", "FRED", "API"),
        Observation("CPIAUCNS", "2026-06-01", 100.3, "2026-07-14", "FRED", "API"),
        Observation("forecast_cpi_mom", "2026-06-01", 0.2, "2026-07-10", "MACROGAUGE", "MODEL"),
    ]
    vintage.append(rows, tmp_path)
    nowcast = {"reference_month": "2026-07", "generated_on": "2026-07-15",
               "cpi": {"mom_pct": 0.25, "as_of": "2026-07-15"}}
    result = phase3.build_accountability("cpi", nowcast, vintage.load(tmp_path))
    assert result["graded"][0]["badge"] == "LIVE"
    assert result["graded"][0]["actual"] == 0.3
    assert result["graded"][0]["error"] == -0.1


def test_accountability_pending_empty_when_forecast_unavailable(tmp_path: Path):
    # Calendar-exhausted nowcast: forecast dict exists but status is
    # "unavailable" — pending must stay empty, not claim a LIVE forecast of None.
    nowcast = {"reference_month": None, "generated_on": "2026-12-11",
               "cpi": {"mom_pct": None, "status": "unavailable", "as_of": None}}
    result = phase3.build_accountability("cpi", nowcast, vintage.load(tmp_path))
    assert result["pending"] == []


def test_accountability_skips_actual_spanning_missing_month(tmp_path: Path):
    # The 2025-10 CPI print was never published (government shutdown):
    # 2025-11's first release follows 2025-09 in the store, so a
    # consecutive-row diff grades the 2025-11 forecast against a 2-month
    # change. That period must be skipped; 2025-12 (true prior month
    # present) still grades.
    rows = [
        Observation("CPIAUCNS", "2025-09-01", 100.0, "2025-10-15", "FRED", "API"),
        Observation("CPIAUCNS", "2025-11-01", 100.8, "2025-12-18", "FRED", "API"),
        Observation("CPIAUCNS", "2025-12-01", 101.0, "2026-01-13", "FRED", "API"),
        Observation("forecast_cpi_mom", "2025-11-01", 0.3, "2025-12-10", "MACROGAUGE", "MODEL"),
        Observation("forecast_cpi_mom", "2025-12-01", 0.2, "2026-01-10", "MACROGAUGE", "MODEL"),
    ]
    vintage.append(rows, tmp_path)
    nowcast = {"reference_month": "2026-01", "generated_on": "2026-01-15",
               "cpi": {"mom_pct": 0.25, "as_of": "2026-01-15"}}
    result = phase3.build_accountability("cpi", nowcast, vintage.load(tmp_path))
    periods = [g["reference_period"] for g in result["graded"]]
    assert "2025-11" not in periods
    assert periods == ["2025-12"]
    assert result["graded"][0]["actual"] == round((101.0 / 100.8 - 1) * 100, 2)


def test_latest_benchmarks_filters_to_reference_month(tmp_path: Path):
    rows = [
        # old-convention leftover (obs_date = scrape day) must NOT match
        Observation("kalshi_cpi_mom", "2026-07-10", 0.99, "2026-07-10", "KALSHI", "API"),
        # new-convention rows: June reference, retrieved on two days (latest vintage wins)
        Observation("kalshi_cpi_mom", "2026-06-01", 0.21, "2026-07-09", "KALSHI", "API"),
        Observation("kalshi_cpi_mom", "2026-06-01", 0.22, "2026-07-11", "KALSHI", "API"),
        Observation("cleveland_cpi_mom", "2026-06-01", 0.18, "2026-07-11", "CLEVELAND", "SCRAPE"),
    ]
    vintage.append(rows, tmp_path)
    out = phase3.latest_benchmarks(vintage.load(tmp_path), "2026-06")
    assert out["kalshi"] == {"value": 0.22, "as_of": "2026-07-11"}
    assert out["cleveland"] == {"value": 0.18, "as_of": "2026-07-11"}
    assert out["street"] is None  # no row for the month


def test_latest_benchmarks_none_reference_month(tmp_path: Path):
    out = phase3.latest_benchmarks(vintage.load(tmp_path), None)
    assert out == {"cleveland": None, "street": None, "kalshi": None}


def test_record_forecasts_uses_nfp_own_reference_month(tmp_path: Path):
    conn = vintage.load(tmp_path)
    nowcast = {"reference_month": "2026-06", "generated_on": "2026-07-10",
               "cpi": {"mom_pct": 0.25}, "pce": {"mom_pct": 0.2},
               "nfp": {"change_thousands": 110, "reference_month": "2026-07"}}
    written = phase3.record_forecasts(nowcast, conn, tmp_path, "2026-07-10")
    assert written == 3
    row = conn.execute("SELECT obs_date FROM observations "
                       "WHERE series_code = 'forecast_nfp_change'").fetchone()
    assert row[0] == "2026-07-01"  # NFP's own month, not CPI's 2026-06
