from pathlib import Path

from pipeline.publish import qa, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

FRESH = {"series_code": "CPIAUCNS", "month": "2026-05-01",
         "yoy_pct": 2.69, "prev_yoy_pct": 2.5, "as_of": "2026-07-07"}


def test_all_green_when_fresh():
    r = qa.run_checks(FRESH, today="2026-07-07")
    # headline_current, yoy_finite, engine_ok, nowcast_ok, outlook_ok, composites_ok,
    # datacenter_ok, geography_ok
    assert (r["passed"], r["total"]) == (8, 8)
    assert all(c["pass"] for c in r["checks"])


def test_stale_headline_fails():
    r = qa.run_checks(FRESH, today="2026-10-01")  # 153 days after 2026-05-01
    by_name = {c["name"]: c for c in r["checks"]}
    assert by_name["headline_current"]["pass"] is False
    assert r["passed"] == 7


def test_nan_yoy_fails():
    r = qa.run_checks({**FRESH, "yoy_pct": float("nan")}, today="2026-07-07")
    by_name = {c["name"]: c for c in r["checks"]}
    assert by_name["yoy_finite"]["pass"] is False


def test_write_validates_against_schema(tmp_path):
    path = qa.write(qa.run_checks(FRESH, today="2026-07-07"), tmp_path)
    validate.validate_file(path, SCHEMAS / "qa.schema.json")


from pipeline.collect import SourceResult


def _res(name, ok, err=None):
    return SourceResult(name, ok, 1 if ok else 0, 0, err, "2026-07-07T12:41:00Z")


def test_connector_and_freshness_checks_green():
    r = qa.run_checks(FRESH, today="2026-07-07",
                      source_results=[_res("FRED", True), _res("EIA", True)],
                      freshness=[{"code": "CPIAUCNS", "latest_obs": "2026-05-01",
                                  "limit_days": 80}])
    assert (r["passed"], r["total"]) == (10, 10)


def test_connector_failure_flagged_not_critical():
    r = qa.run_checks(FRESH, today="2026-07-07",
                      source_results=[_res("FRED", True),
                                      _res("EIA", False, "HTTPError: 503")])
    by = {c["name"]: c for c in r["checks"]}
    assert by["connectors_ok"]["pass"] is False
    assert by["connectors_ok"]["critical"] is False
    assert "EIA" in by["connectors_ok"]["detail"]


def test_stale_and_never_seen_series_flagged():
    r = qa.run_checks(FRESH, today="2026-07-07",
                      freshness=[
                          {"code": "fresh1", "latest_obs": "2026-07-01", "limit_days": 7},
                          {"code": "stale1", "latest_obs": "2026-05-01", "limit_days": 21},
                          {"code": "never1", "latest_obs": None, "limit_days": 7}])
    by = {c["name"]: c for c in r["checks"]}
    assert by["sources_fresh"]["pass"] is False
    assert "stale1" in by["sources_fresh"]["detail"]
    assert "never1" in by["sources_fresh"]["detail"]
    assert "fresh1" not in by["sources_fresh"]["detail"]


def test_stale_days_is_80():
    assert qa.STALE_DAYS == 80


GAUGE_OK = {"as_of": "2026-07-06", "coverage_pct": 40.5,
            "null_components": [], "gate_flags": [], "weights_sum": 1.0,
            "tracker_corr": 0.98}


def test_gauge_checks_all_pass():
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=GAUGE_OK)
    names = [c["name"] for c in r["checks"]]
    for n in ("gauge_current", "gauge_components_present",
              "basket_weights_sum", "gauge_coverage", "tracker_corr"):
        assert n in names
    gauge_checks = [c for c in r["checks"] if c["name"].startswith(("gauge", "basket", "tracker"))]
    assert all(c["pass"] for c in gauge_checks)


def test_gauge_stale_as_of_fails_critical():
    r = qa.run_checks(FRESH, today="2026-07-20", gauge=GAUGE_OK)  # 14d old
    check = [c for c in r["checks"] if c["name"] == "gauge_current"][0]
    assert check["pass"] is False and check["critical"] is True


def test_gauge_gate_flags_surface_in_detail_without_failing():
    g = dict(GAUGE_OK, gate_flags=["fuel@2026-07-06"])
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=g)
    check = [c for c in r["checks"] if c["name"] == "gauge_components_present"][0]
    assert check["pass"] is True
    assert "fuel@2026-07-06" in check["detail"]


def test_gauge_low_coverage_and_null_corr_fail_noncritical():
    g = dict(GAUGE_OK, coverage_pct=20.0, tracker_corr=None)
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=g)
    cov = [c for c in r["checks"] if c["name"] == "gauge_coverage"][0]
    corr = [c for c in r["checks"] if c["name"] == "tracker_corr"][0]
    assert cov["pass"] is False and cov["critical"] is False
    assert corr["pass"] is False and corr["critical"] is False


def test_no_gauge_arg_keeps_existing_checks_only():
    r = qa.run_checks(FRESH, today="2026-07-08")
    assert not any(c["name"].startswith(("gauge", "basket", "tracker"))
                   for c in r["checks"])


def test_engine_ok_passes_when_no_error():
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=GAUGE_OK)
    eng = [c for c in r["checks"] if c["name"] == "engine_ok"][0]
    assert eng["pass"] is True and eng["critical"] is True


def test_engine_error_fails_engine_ok_and_headline_tolerates_none_cpi():
    r = qa.run_checks(None, today="2026-07-08", engine_error="RuntimeError: boom")
    eng = [c for c in r["checks"] if c["name"] == "engine_ok"][0]
    assert eng["pass"] is False and "boom" in eng["detail"]
    head = [c for c in r["checks"] if c["name"] == "headline_current"][0]
    assert head["pass"] is False and "boom" in head["detail"]
    fin = [c for c in r["checks"] if c["name"] == "yoy_finite"][0]
    assert fin["pass"] is False


def _cpi():
    return FRESH


def _by_name(result, name):
    return next((c for c in result["checks"] if c["name"] == name), None)


def test_nowcast_ok_and_composites_ok_pass_when_no_error():
    r = qa.run_checks(FRESH, today="2026-07-08")
    now = [c for c in r["checks"] if c["name"] == "nowcast_ok"][0]
    comp = [c for c in r["checks"] if c["name"] == "composites_ok"][0]
    assert now["pass"] is True and now["critical"] is False
    assert comp["pass"] is True and comp["critical"] is False


def test_nowcast_error_fails_nowcast_ok_without_touching_engine_ok():
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=GAUGE_OK,
                      nowcast_error="ValueError: release calendar has no future CPI print")
    now = [c for c in r["checks"] if c["name"] == "nowcast_ok"][0]
    eng = [c for c in r["checks"] if c["name"] == "engine_ok"][0]
    assert now["pass"] is False and "release calendar" in now["detail"]
    assert eng["pass"] is True  # nowcast failure is isolated from the gauge engine


def test_outlook_error_fails_outlook_ok_without_touching_engine_ok():
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=GAUGE_OK,
                      outlook_error="RuntimeError: forecast base missing")
    outlook = _by_name(r, "outlook_ok")
    eng = _by_name(r, "engine_ok")
    assert outlook["pass"] is False and "forecast base" in outlook["detail"]
    assert outlook["critical"] is False
    assert eng["pass"] is True


def test_composites_error_fails_composites_ok_without_touching_engine_ok():
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=GAUGE_OK,
                      composites_error="RuntimeError: heatcheck boom")
    comp = [c for c in r["checks"] if c["name"] == "composites_ok"][0]
    eng = [c for c in r["checks"] if c["name"] == "engine_ok"][0]
    assert comp["pass"] is False and "heatcheck boom" in comp["detail"]
    assert eng["pass"] is True  # composites failure is isolated from the gauge engine


def test_fuel_divergence_check_passes_within_band():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           fuel_divergence={"aaa_wk_avg": 3.10, "eia": 3.05,
                                            "rel": abs(3.10 / 3.05 - 1), "n_obs": 7})
    check = _by_name(result, "fuel_sources_agree")
    assert check["pass"] is True
    assert "AAA avg over 7 obs" in check["detail"]


def test_fuel_divergence_check_fails_beyond_band():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           fuel_divergence={"aaa_wk_avg": 3.60, "eia": 3.00,
                                            "rel": 0.20, "n_obs": 7})
    check = _by_name(result, "fuel_sources_agree")
    assert check["pass"] is False
    assert "AAA avg over 7 obs" in check["detail"]


def test_fuel_divergence_absent_sources_pass_with_detail():
    result = qa.run_checks(_cpi(), today="2026-07-10", fuel_divergence=None)
    assert _by_name(result, "fuel_sources_agree") is None  # check only added when computed


def test_fuel_divergence_rel_fallback_when_omitted():
    # rel is omitted; qa.py computes fallback: abs(aaa / eia - 1)
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           fuel_divergence={"aaa_wk_avg": 3.10, "eia": 3.00, "n_obs": 7})
    check = _by_name(result, "fuel_sources_agree")
    assert check["pass"] is True  # fallback rel = abs(3.10/3.00 - 1) ≈ 0.033 < 0.075
    assert "AAA avg over 7 obs" in check["detail"]
    # The detail string gets constructed with the fallback rel value


def test_artifact_checks():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           artifacts={"quilt_months": 30, "grocery_items": 24,
                                      "grocery_skipped": 1, "quilt_aligned": True})
    assert _by_name(result, "quilt_complete")["pass"] is True
    assert _by_name(result, "grocery_items")["pass"] is True


def test_artifact_checks_absent_when_no_artifacts():
    result = qa.run_checks(_cpi(), today="2026-07-10")
    assert _by_name(result, "quilt_complete") is None
    assert _by_name(result, "grocery_items") is None


def test_quilt_incomplete_fails_noncritical():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           artifacts={"quilt_months": 12, "grocery_items": 24,
                                      "grocery_skipped": 1, "quilt_aligned": True})
    check = _by_name(result, "quilt_complete")
    assert check["pass"] is False and check["critical"] is False


def test_quilt_misaligned_arrays_fail_noncritical():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           artifacts={"quilt_months": 30, "grocery_items": 24,
                                      "grocery_skipped": 1, "quilt_aligned": False})
    check = _by_name(result, "quilt_complete")
    assert check["pass"] is False and check["critical"] is False
    assert "misaligned" in check["detail"]


def test_grocery_items_below_floor_fails_noncritical():
    result = qa.run_checks(_cpi(), today="2026-07-10",
                           artifacts={"quilt_months": 30, "grocery_items": 10,
                                      "grocery_skipped": 5})
    check = _by_name(result, "grocery_items")
    assert check["pass"] is False and check["critical"] is False


def test_coverage_floor_is_40_with_self_explaining_detail():
    g = dict(GAUGE_OK, coverage_pct=40.0)
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=g)
    cov = _by_name(r, "gauge_coverage")
    assert cov["pass"] is True
    assert "40" in cov["detail"]
    assert "food_home" in cov["detail"]


def test_coverage_just_below_new_floor_fails():
    g = dict(GAUGE_OK, coverage_pct=39.9)
    r = qa.run_checks(FRESH, today="2026-07-08", gauge=g)
    cov = _by_name(r, "gauge_coverage")
    assert cov["pass"] is False


def test_datacenter_ok_check():
    ok = qa.run_checks(None, today="2026-07-12", engine_error="x")
    names = {c["name"]: c for c in ok["checks"]}
    assert names["datacenter_ok"]["pass"] is True

    bad = qa.run_checks(None, today="2026-07-12", engine_error="x",
                        datacenter_error="RuntimeError: dc boom")
    names = {c["name"]: c for c in bad["checks"]}
    assert names["datacenter_ok"]["pass"] is False
    assert names["datacenter_ok"]["critical"] is False
    assert "dc boom" in names["datacenter_ok"]["detail"]


def test_geography_ok_check():
    ok = qa.run_checks(None, today="2026-07-12", engine_error="x")
    names = {c["name"]: c for c in ok["checks"]}
    assert names["geography_ok"]["pass"] is True

    bad = qa.run_checks(None, today="2026-07-12", engine_error="x",
                        geography_error="RuntimeError: geo boom")
    names = {c["name"]: c for c in bad["checks"]}
    assert names["geography_ok"]["pass"] is False
    assert names["geography_ok"]["critical"] is False
    assert "geo boom" in names["geography_ok"]["detail"]
