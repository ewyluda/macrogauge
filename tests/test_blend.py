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


def test_hub_mean_two_present_mean():
    a = {"2018-01-01": 10.0, "2018-01-02": 20.0}
    b = {"2018-01-01": 20.0, "2018-01-02": 30.0}
    out = blend.hub_mean([a, b])
    assert out == {"2018-01-01": 15.0, "2018-01-02": 25.0}


def test_hub_mean_one_missing_carries():
    # one hub missing a day must not drop the day — the mean is over
    # whichever hubs actually have that date, not a forward-fill
    a = {"2018-01-01": 10.0, "2018-01-02": 20.0}
    b = {"2018-01-01": 10.0}
    out = blend.hub_mean([a, b])
    assert out == {"2018-01-01": 10.0, "2018-01-02": 20.0}


def test_hub_mean_disjoint_dates_union():
    a = {"2018-01-01": 10.0}
    b = {"2018-01-02": 20.0}
    out = blend.hub_mean([a, b])
    assert out == {"2018-01-01": 10.0, "2018-01-02": 20.0}


def test_hub_mean_empty_list_is_empty_dict():
    assert blend.hub_mean([]) == {}


def test_trailing_mean_worked_example():
    s = {"2018-01-01": 10.0, "2018-01-02": 20.0, "2018-01-03": 30.0}
    out = blend.trailing_mean(s, days=2)
    assert out == {"2018-01-01": 10.0, "2018-01-02": 15.0, "2018-01-03": 25.0}


def test_trailing_mean_gap_shrinks_the_window():
    # missing middle day: the days=3 window at d3 would normally average 3
    # values, but only 2 exist -> shrink, never fabricate the gap
    s = {"2018-01-01": 10.0, "2018-01-03": 30.0}
    out = blend.trailing_mean(s, days=3)
    assert out["2018-01-01"] == pytest.approx(10.0)
    assert out["2018-01-03"] == pytest.approx(20.0)


def test_trailing_mean_days_one_is_identity():
    s = {"2018-01-01": 10.0, "2018-01-02": 20.0}
    assert blend.trailing_mean(s, days=1) == s


def test_splice_anchored_edges():
    official = {"2017-01-01": 100.0}
    assert blend.splice_anchored(official, {}) == official
    assert blend.splice_anchored({}, {"2017-01-02": 5.0}) == {"2017-01-02": 5.0}
    # live entirely after the anchor with no overlap: cannot scale -> official only
    assert blend.splice_anchored(official, {"2017-02-01": 55.0}) == official
    # zero at the scaling point: official only (no div-by-zero)
    assert blend.splice_anchored(official, {"2016-12-31": 0.0, "2017-02-01": 5.0}) == official


def test_year_ratio_worked_example():
    # Hand-computed (spec §3, λ=0.5, tolerance 7d):
    # T0=2026-04-01. model(T0): official_ffill(2025-04-01)=100,
    #   W(t0)→2026-03-29=44 (3d), W(t0-365d)→2025-03-30=40 (2d)
    #   m0 = 100*(1+0.5*(44/40-1)) = 105; anchor = 110/105
    # t=2026-07-10: official_ffill(2025-07-10)=100 (ffill from 2025-04-01),
    #   W(t)=60, W(t-365d)→2025-07-08=50 (2d)
    #   model = 100*(1+0.5*(60/50-1)) = 110 → tail = 110*110/105
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-07-08": 50.0,
            "2026-03-29": 44.0, "2026-07-10": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert out["2025-04-01"] == 100.0 and out["2026-04-01"] == 110.0
    assert out["2026-07-10"] == pytest.approx(110.0 * 110.0 / 105.0)
    # live points at/before the anchor never enter the output
    assert "2026-03-29" not in out and "2025-03-30" not in out


def test_year_ratio_cancels_seasonality_where_level_splice_explodes():
    """The wave-4 regression pin: flat retail + a wholesale series that swings
    20→55 $/MWh every summer (the observed ~2.8x). splice_anchored maps the
    seasonal rise onto the flat tail (+175% spurious); splice_year_ratio
    compares summer to LAST summer and stays flat."""
    official = {}
    for y, m in [(y, m) for y in (2025, 2026) for m in range(1, 13)]:
        d = f"{y}-{m:02d}-01"
        if d <= "2026-04-01":
            official[d] = 100.0
    live = {}
    for y in (2025, 2026):
        for m in range(1, 13):
            for day in (1, 8, 15, 22):
                d = f"{y}-{m:02d}-{day:02d}"
                if "2025-01-01" <= d <= "2026-07-08":
                    live[d] = 55.0 if m in (6, 7, 8) else 20.0
    exploded = blend.splice_anchored(official, live)
    assert max(v for d, v in exploded.items() if d > "2026-04-01") > 200.0
    honest = blend.splice_year_ratio(official, live, passthrough=1.0)
    tail = {d: v for d, v in honest.items() if d > "2026-04-01"}
    assert tail  # the tail exists…
    for v in tail.values():
        assert v == pytest.approx(100.0)  # …and is flat: seasonality cancelled


def test_year_ratio_tolerance_skips_unbridgeable_dates():
    # W(t-365d) nearest obs is 9 days old -> that tail date is skipped
    # (never fabricate); the anchor (2d/3d gaps) is unaffected.
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-07-01": 50.0,
            "2026-03-29": 44.0, "2026-07-10": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert "2026-07-10" not in out            # 2025-07-10 lookup gap = 9d
    assert max(out) == "2026-04-01"


def test_year_ratio_no_anchor_returns_official_only():
    # no W obs within tolerance at/before T0 -> dormant, official untouched
    # (mirrors splice_anchored's no-overlap edge)
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2026-07-08": 50.0, "2026-07-10": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert out == official and out is not official


def test_year_ratio_lambda_zero_repeats_last_years_shape():
    # λ=0: model(t) = official_ffill(t-365d); NOT flat carry-forward —
    # the tail replays last year's official shape, anchor-scaled at T0.
    official = {"2025-04-01": 100.0, "2025-06-01": 104.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-06-05": 50.0,
            "2026-03-29": 44.0, "2026-06-05": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.0000001)
    # (λ→0 limit; exact 0 is rejected by the loader, the engine accepts any λ)
    # m0 ≈ 100, anchor ≈ 1.1; t=2026-06-05: official_ffill(2025-06-05)=104
    assert out["2026-06-05"] == pytest.approx(104.0 * 1.1, rel=1e-4)


def test_year_ratio_negative_or_zero_denominator_skips():
    # negative smoothed wholesale is real (curtailment) but a ratio against
    # it is meaningless -> skip the date, keep the rest of the tail
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-07-08": -5.0, "2025-08-05": 50.0,
            "2026-03-29": 44.0, "2026-07-10": 60.0, "2026-08-07": 55.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert "2026-07-10" not in out            # W(2025-07-10)→-5.0: skipped
    assert "2026-08-07" in out                # healthy neighbor still splices


def test_year_ratio_edges():
    official = {"2025-04-01": 100.0}
    assert blend.splice_year_ratio(official, {}, 0.5) == official
    assert blend.splice_year_ratio({}, {"2026-01-01": 5.0}, 0.5) == {}
