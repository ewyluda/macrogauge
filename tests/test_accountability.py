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
