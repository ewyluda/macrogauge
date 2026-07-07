import pytest

from pipeline.engine import official
from pipeline.models import Observation
from pipeline.store import vintage


def seed(tmp_path, rows):
    obs = [Observation(series_code="CPIAUCNS", obs_date=d, value=v,
                       vintage_date="2026-07-07", source="FRED", route="API")
           for d, v in rows]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_latest_yoy_hand_computed(tmp_path):
    conn = seed(tmp_path, [("2025-05-01", 300.0), ("2025-06-01", 301.0),
                           ("2026-05-01", 307.5), ("2026-06-01", 309.1)])
    r = official.latest_yoy(conn, "CPIAUCNS")
    assert r["series_code"] == "CPIAUCNS"
    assert r["month"] == "2026-06-01"
    assert r["yoy_pct"] == pytest.approx((309.1 / 301.0 - 1) * 100)   # 2.6910...
    assert r["prev_yoy_pct"] == pytest.approx((307.5 / 300.0 - 1) * 100)  # 2.5
    assert r["as_of"] == "2026-07-07"


def test_missing_base_month_raises(tmp_path):
    conn = seed(tmp_path, [("2026-06-01", 309.1)])
    with pytest.raises(ValueError):
        official.latest_yoy(conn, "CPIAUCNS")
