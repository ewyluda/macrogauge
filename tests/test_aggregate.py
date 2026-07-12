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


def test_fill_yoy_forward_fills_and_preserves_none():
    y = {"2026-01-01": 2.0, "2026-01-04": None, "2026-01-06": 3.0}
    f = aggregate.fill_yoy(y, "2026-01-01", "2026-01-07")
    assert f == {"2026-01-01": 2.0, "2026-01-02": 2.0, "2026-01-03": 2.0,
                 "2026-01-04": None, "2026-01-05": None,
                 "2026-01-06": 3.0, "2026-01-07": 3.0}


def test_fill_yoy_no_backfill_before_first_obs():
    f = aggregate.fill_yoy({"2026-01-03": 1.0}, "2026-01-01", "2026-01-04")
    assert sorted(f) == ["2026-01-03", "2026-01-04"]


def test_weighted_yoy_intersection_and_renormalization():
    ys = {"a": {"2026-01-01": 2.0, "2026-01-02": 4.0},
          "b": {"2026-01-02": 1.0}}
    out = aggregate.weighted_yoy(ys, {"a": 0.6, "b": 0.2})
    # only 2026-01-02 shared; weights renormalize to .75/.25
    assert out == {"2026-01-02": pytest.approx(4.0 * 0.75 + 1.0 * 0.25)}


def test_weighted_yoy_none_component_makes_date_none():
    ys = {"a": {"2026-01-01": 2.0}, "b": {"2026-01-01": None}}
    assert aggregate.weighted_yoy(ys, {"a": 0.5, "b": 0.5}) == {"2026-01-01": None}


def test_weighted_yoy_empty_returns_empty():
    assert aggregate.weighted_yoy({}, {}) == {}


def test_yoy_at_obs_skips_base_month_hole():
    # The 2018-10 print was never published (2025-10 shutdown-hole analog):
    # the 2019-10-01 obs has no like-month base, and the forward-filled grid
    # would silently supply the Sep-2018 value — a 13-month change. That obs
    # date must be OMITTED (not None) so fill_yoy carries the last honest
    # YoY forward instead of fabricating one or None-poisoning the headline.
    obs = {"2018-09-01": 202.0, "2018-11-01": 203.0,
           "2019-09-01": 210.0, "2019-10-01": 212.0}
    filled = aggregate.fill_daily(obs, "2018-09-01", "2019-10-01")
    y = aggregate.yoy_at_obs(obs, filled)
    assert y["2019-09-01"] == pytest.approx((210.0 / 202.0 - 1) * 100)
    assert "2019-10-01" not in y  # base month 2018-10 has no genuine obs


def test_yoy_at_obs_keeps_none_when_base_predates_grid():
    # A base that predates the filled domain is None, NOT skipped — early
    # obs must keep seeding fill_yoy's domain exactly as before.
    obs = {"2018-09-01": 202.0, "2018-11-01": 203.0,
           "2019-09-01": 210.0, "2019-10-01": 212.0}
    filled = aggregate.fill_daily(obs, "2018-09-01", "2019-10-01")
    y = aggregate.yoy_at_obs(obs, filled)
    assert y["2018-09-01"] is None
    assert y["2018-11-01"] is None
