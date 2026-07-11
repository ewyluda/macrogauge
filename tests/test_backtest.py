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
