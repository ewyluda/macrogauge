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
    assert out["2018-02-01"] == pytest.approx(105.0)  # equal-weight mean


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
