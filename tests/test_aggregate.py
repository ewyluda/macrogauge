import pytest

from pipeline.engine import aggregate


def test_fill_daily_forward_fills():
    s = {"2026-01-01": 100.0, "2026-01-04": 103.0}
    f = aggregate.fill_daily(s, "2026-01-01", "2026-01-05")
    assert f == {"2026-01-01": 100.0, "2026-01-02": 100.0, "2026-01-03": 100.0,
                 "2026-01-04": 103.0, "2026-01-05": 103.0}


def test_fill_daily_no_backfill_before_first_obs():
    s = {"2026-01-03": 100.0}
    f = aggregate.fill_daily(s, "2026-01-01", "2026-01-04")
    assert sorted(f) == ["2026-01-03", "2026-01-04"]


def test_headline_intersection_and_renormalized_weights():
    comps = {"a": {"2026-01-01": 100.0, "2026-01-02": 110.0},
             "b": {"2026-01-02": 100.0}}
    idx = aggregate.headline(comps, {"a": 0.6, "b": 0.2})
    # only 2026-01-02 has both; weights renormalize to .75/.25
    assert idx == {"2026-01-02": pytest.approx(110 * 0.75 + 100 * 0.25)}


def test_yoy_365_day_base():
    idx = {"2025-01-01": 100.0, "2025-06-01": 101.0, "2026-01-01": 103.0}
    y = aggregate.yoy(idx)
    assert y["2026-01-01"] == pytest.approx(3.0)
    assert y["2025-01-01"] is None  # no base a year earlier
    assert y["2025-06-01"] is None


def test_yoy_zero_base_value_is_computed_not_none():
    idx = {"2025-01-01": 0.0, "2026-01-01": 103.0}
    with pytest.raises(ZeroDivisionError):
        aggregate.yoy(idx)


def test_headline_empty_components_returns_empty():
    assert aggregate.headline({}, {}) == {}
