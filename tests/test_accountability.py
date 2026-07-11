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
