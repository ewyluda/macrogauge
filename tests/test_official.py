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


def seed_code(tmp_path, code, rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-07", source="T", route="API")
           for d, v in rows]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_component_summary_hand_computed(tmp_path):
    conn = seed_code(tmp_path, "COMP", [
        ("2025-05-01", 200.0), ("2026-04-01", 205.0), ("2026-05-01", 206.0)])
    r = official.component_summary(conn, "COMP")
    assert r["code"] == "COMP" and r["month"] == "2026-05-01"
    assert r["yoy_pct"] == pytest.approx((206.0 / 200.0 - 1) * 100)  # 3.0
    assert r["mom_pct"] == pytest.approx((206.0 / 205.0 - 1) * 100)  # 0.4878...


def test_component_summary_missing_base_raises(tmp_path):
    conn = seed_code(tmp_path, "COMP2", [("2026-04-01", 205.0), ("2026-05-01", 206.0)])
    with pytest.raises(ValueError):
        official.component_summary(conn, "COMP2")


def test_latest_quote_weekly_series(tmp_path):
    conn = seed_code(tmp_path, "GAS", [
        ("2025-06-30", 3.20), ("2025-07-07", 3.25), ("2026-06-29", 3.40)])
    r = official.latest_quote(conn, "GAS")
    assert (r["latest"], r["obs_date"]) == (3.40, "2026-06-29")
    # target base date = 2026-06-29 - 365d = 2025-06-29; nearest at/before = 2025-06-30? NO —
    # 2025-06-30 is AFTER 2025-06-29, so nearest at/before within 60d... none earlier exists?
    # 2025-06-30 > target, 2025-07-07 > target -> no base at/before target -> yoy None
    assert r["yoy_pct"] is None


def test_latest_quote_base_found(tmp_path):
    conn = seed_code(tmp_path, "GAS2", [
        ("2025-06-20", 3.20), ("2026-06-29", 3.40)])
    r = official.latest_quote(conn, "GAS2")
    # target 2025-06-29; nearest at/before = 2025-06-20 (9d gap, within 60d)
    assert r["yoy_pct"] == pytest.approx((3.40 / 3.20 - 1) * 100)  # 6.25


def test_latest_quote_stale_base_is_none(tmp_path):
    conn = seed_code(tmp_path, "GAS3", [
        ("2025-03-01", 3.00), ("2026-06-29", 3.40)])
    r = official.latest_quote(conn, "GAS3")
    assert r["yoy_pct"] is None  # base 115d before target — outside 60d tolerance


def test_latest_yoy_skips_month_with_missing_base(tmp_path):
    # 2025-10 print never published (shutdown): Oct-2026 YoY has no base ->
    # headline falls back to the latest computable month (Sep 2026)
    conn = seed(tmp_path, [
        ("2025-08-01", 298.0), ("2025-09-01", 299.0), ("2025-11-01", 301.0),
        ("2026-08-01", 305.0), ("2026-09-01", 306.0), ("2026-10-01", 307.0)])
    r = official.latest_yoy(conn, "CPIAUCNS")
    assert r["month"] == "2026-09-01"
    assert r["yoy_pct"] == pytest.approx((306.0 / 299.0 - 1) * 100)
    assert r["prev_yoy_pct"] == pytest.approx((305.0 / 298.0 - 1) * 100)


def test_latest_yoy_no_computable_month_raises(tmp_path):
    conn = seed(tmp_path, [("2026-09-01", 306.0), ("2026-10-01", 307.0)])
    with pytest.raises(ValueError):
        official.latest_yoy(conn, "CPIAUCNS")


def test_component_summary_skips_month_with_missing_base(tmp_path):
    conn = seed_code(tmp_path, "COMP9", [
        ("2025-09-01", 200.0), ("2025-11-01", 202.0),
        ("2026-08-01", 204.0), ("2026-09-01", 205.0), ("2026-10-01", 206.0)])
    r = official.component_summary(conn, "COMP9")
    assert r["month"] == "2026-09-01"
    assert r["yoy_pct"] == pytest.approx((205.0 / 200.0 - 1) * 100)
    assert r["mom_pct"] == pytest.approx((205.0 / 204.0 - 1) * 100)
