"""Phase-1 exit criterion: the tracker re-tracks official CPI on the
committed 2018-now store (design doc §10: corr >= 0.95)."""
from pathlib import Path

from pipeline.engine import gauge
from pipeline.publish import compare
from pipeline.store import vintage

ROOT = Path(__file__).parent.parent


def test_tracker_corr_vs_official_2018_now():
    conn = vintage.load(ROOT / "store")
    # far-future 'today': no obs can be just-arrived, staleness irrelevant here
    result = gauge.run(conn, today="2099-01-01")
    v = compare.build(result, conn)["validation"]["tracker"]
    assert v["corr"] is not None, "no overlapping months — engine misaligned"
    assert v["corr"] >= 0.95, f"tracker corr {v['corr']} < 0.95 ({v['window']})"


def test_gauge_backfill_sane():
    conn = vintage.load(ROOT / "store")
    result = gauge.run(conn, today="2099-01-01")
    g = result["variants"]["gauge"]
    yoy = g["yoy"][g["as_of"]]
    assert yoy is not None and -5.0 < yoy < 15.0, yoy
    assert min(g["index"]) <= "2018-01-01"  # grid reaches the base year
