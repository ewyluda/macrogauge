import pytest

from pipeline.engine import blend


def test_blend_single_source_passthrough():
    z = {"2018-01-01": 100.0, "2018-02-01": 110.0}
    out = blend.blend({"zori": z}, {"zori": 0.5, "aptlist": 0.3, "redfin": 0.2})
    assert out == {"2018-01-01": 100.0, "2018-02-01": 110.0}


def test_blend_two_sources_renormalized_weights():
    a = {"2018-01-01": 100.0, "2018-02-01": 110.0}
    b = {"2018-01-01": 100.0, "2018-02-01": 100.0}
    out = blend.blend({"a": a, "b": b}, {"a": 0.5, "b": 0.3})
    # renormalized weights 5/8, 3/8 -> 110*0.625 + 100*0.375 = 106.25
    assert out["2018-02-01"] == pytest.approx(106.25)


def test_blend_late_source_joins_midway():
    a = {"2018-01-01": 100.0, "2018-02-01": 110.0}
    b = {"2018-02-01": 100.0}
    out = blend.blend({"a": a, "b": b}, {"a": 0.5, "b": 0.5})
    assert out["2018-01-01"] == pytest.approx(100.0)  # a alone
    assert out["2018-02-01"] == pytest.approx(110.0)  # entry splice: b joins at the blend's level — no cliff on a day nothing moved


def test_blend_all_empty_raises():
    with pytest.raises(ValueError):
        blend.blend({"a": {}, "b": {}}, {"a": 0.5, "b": 0.5})


def test_splice_scales_live_at_first_overlap():
    official = {"2017-01-01": 100.0, "2017-06-01": 104.0, "2018-01-01": 110.0}
    live = {"2017-06-01": 52.0, "2017-07-01": 54.0}
    out = blend.splice(official, live)
    # scale = official(2017-06-01) / live(2017-06-01) = 104/52 = 2.0
    assert out["2017-01-01"] == 100.0                    # official kept pre-live
    assert out["2017-06-01"] == pytest.approx(104.0)
    assert out["2017-07-01"] == pytest.approx(108.0)
    assert "2018-01-01" not in out                       # official post-t0 dropped


def test_splice_live_start_between_official_points_uses_prior():
    official = {"2017-01-01": 100.0, "2017-02-01": 102.0}
    live = {"2017-01-15": 50.0, "2017-02-15": 51.0}
    out = blend.splice(official, live)
    # official at/before 2017-01-15 -> 100.0, scale 2.0
    assert out["2017-01-15"] == pytest.approx(100.0)
    assert out["2017-02-15"] == pytest.approx(102.0)
    assert out["2017-01-01"] == 100.0
    assert "2017-02-01" not in out


def test_splice_empty_live_returns_official_copy():
    official = {"2017-01-01": 100.0}
    out = blend.splice(official, {})
    assert out == official and out is not official


def test_splice_live_predates_official_uses_scale_one():
    official = {"2018-01-01": 110.0}
    live = {"2017-06-01": 52.0, "2018-01-01": 55.0}
    out = blend.splice(official, live)
    assert out["2017-06-01"] == pytest.approx(52.0)
    assert out["2018-01-01"] == pytest.approx(55.0)


def test_shift_days_moves_dates_forward():
    s = {"2026-05-01": 200.0, "2026-06-01": 204.0}
    assert blend.shift_days(s, 30) == {"2026-05-31": 200.0, "2026-07-01": 204.0}


def test_shift_days_zero_is_identity():
    s = {"2026-05-01": 200.0}
    assert blend.shift_days(s, 0) == s


def test_late_entrant_enters_at_blend_level_no_cliff():
    """A source starting after the blend has begun must not step the blend
    to its own anchor level (the 2026-07 fuel cliff): it enters AT the
    incumbents' blended level and contributes relative movement after."""
    a = {"2018-01-01": 100.0, "2018-01-02": 100.0, "2018-01-03": 102.0}
    b = {"2018-01-03": 50.0, "2018-01-04": 55.0}  # own-anchor basis
    out = blend.blend({"a": a, "b": b}, {"a": 0.7, "b": 0.3})
    # entry date: continuous with the incumbent level, no cliff
    assert out["2018-01-03"] == pytest.approx(102.0)
    # next day: b scaled by 102/50 = 2.04 -> 55*2.04 = 112.2 (hand-computed)
    # a forward-fills 102: 0.7*102 + 0.3*112.2 = 105.06
    assert out["2018-01-04"] == pytest.approx(105.06)


def test_sources_from_first_date_keep_original_behavior():
    """Sources present at the blend's first date are unscaled — existing
    shelter-blend behavior (both legs 2018-based) must not change."""
    a = {"2018-01-01": 100.0, "2018-01-02": 110.0}
    b = {"2018-01-01": 100.0, "2018-01-02": 90.0}
    out = blend.blend({"a": a, "b": b}, {"a": 0.5, "b": 0.5})
    assert out["2018-01-01"] == pytest.approx(100.0)
    assert out["2018-01-02"] == pytest.approx(100.0)


def test_splice_anchored_keeps_official_and_scales_tail():
    official = {"2017-01-01": 100.0, "2017-02-01": 102.0}
    live = {"2017-01-15": 50.0, "2017-02-10": 52.0, "2017-03-01": 55.0}
    out = blend.splice_anchored(official, live)
    # official values never overwritten
    assert out["2017-01-01"] == 100.0 and out["2017-02-01"] == 102.0
    # tail scaled at the LAST official obs: scale = 102 / live(2017-01-15) = 2.04
    assert out["2017-02-10"] == pytest.approx(52.0 * 2.04)
    assert out["2017-03-01"] == pytest.approx(55.0 * 2.04)
    # live points at/before the anchor never enter the output
    assert "2017-01-15" not in out


def test_splice_anchored_reanchors_on_new_print():
    official = {"2017-01-01": 100.0, "2017-02-01": 102.0, "2017-03-01": 110.0}
    live = {"2017-01-15": 50.0, "2017-02-10": 52.0, "2017-03-01": 55.0,
            "2017-03-20": 56.0}
    out = blend.splice_anchored(official, live)
    # anchor moved to 2017-03-01: scale = 110/55 = 2.0 — drift does not compound
    assert out["2017-03-01"] == 110.0
    assert out["2017-03-20"] == pytest.approx(112.0)
    assert "2017-02-10" not in out  # official backbone covers that span now


def test_splice_anchored_edges():
    official = {"2017-01-01": 100.0}
    assert blend.splice_anchored(official, {}) == official
    assert blend.splice_anchored({}, {"2017-01-02": 5.0}) == {"2017-01-02": 5.0}
    # live entirely after the anchor with no overlap: cannot scale -> official only
    assert blend.splice_anchored(official, {"2017-02-01": 55.0}) == official
    # zero at the scaling point: official only (no div-by-zero)
    assert blend.splice_anchored(official, {"2016-12-31": 0.0, "2017-02-01": 5.0}) == official
