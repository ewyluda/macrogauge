from pathlib import Path

from pipeline.engine import backtest
from pipeline.models import Observation
from pipeline.store import vintage


def test_walk_forward_uses_pre_release_vintages(tmp_path: Path):
    obs = []
    level = 100.0
    for month in range(1, 9):
        level *= 1.002
        obs.append(Observation("CPIAUCNS", f"2025-{month:02d}-01", level,
                               f"2025-{month + 1:02d}-10", "FRED", "API"))
    vintage.append(obs, tmp_path)
    result = backtest.cpi_walk_forward(vintage.load(tmp_path))
    assert result["rows"]
    assert all(row["badge"] == "BT" for row in result["rows"])
    assert all(row["cutoff"] < row["release_date"] for row in result["rows"])


def test_walk_forward_skips_target_month_after_hole(tmp_path: Path):
    # The 2025-10 print was never published (government shutdown): 2025-11's
    # first-release follows 2025-09, so a consecutive-row diff calls a
    # 2-month change "MoM". That target must not be graded, and the
    # hole-spanning change must never enter the trailing-3m forecast inputs.
    obs, level = [], 100.0
    months = [f"2025-{m:02d}" for m in range(1, 10)] + ["2025-11", "2025-12", "2026-01"]
    releases = [f"2025-{m:02d}-10" for m in range(2, 10)] + [
        "2025-12-18", "2026-01-13", "2026-02-11", "2026-03-11"]
    for month, released in zip(months, releases):
        level *= 1.002
        obs.append(Observation("CPIAUCNS", f"{month}-01", level,
                               released, "FRED", "API"))
    vintage.append(obs, tmp_path)
    result = backtest.cpi_walk_forward(vintage.load(tmp_path))
    graded = [row["target_month"] for row in result["rows"]]
    assert "2025-11" not in graded  # its "actual" would be a 2-month change
    assert "2025-12" in graded and "2026-01" in graded
    # every graded actual/naive is an honest 1-month change (~0.2), never
    # the ~0.4 hole-spanning change
    for row in result["rows"]:
        assert abs(row["actual_mom_pct"] - 0.2) < 0.05, row
        assert abs(row["naive_mom_pct"] - 0.2) < 0.05, row
