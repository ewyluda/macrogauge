from pathlib import Path

from pipeline.publish import qa, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

FRESH = {"series_code": "CPIAUCNS", "month": "2026-05-01",
         "yoy_pct": 2.69, "prev_yoy_pct": 2.5, "as_of": "2026-07-07"}


def test_all_green_when_fresh():
    r = qa.run_checks(FRESH, today="2026-07-07")
    assert (r["passed"], r["total"]) == (3, 3)
    assert all(c["pass"] for c in r["checks"])


def test_stale_headline_fails():
    r = qa.run_checks(FRESH, today="2026-10-01")  # 153 days after 2026-05-01
    by_name = {c["name"]: c for c in r["checks"]}
    assert by_name["headline_current"]["pass"] is False
    assert r["passed"] == 2


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
    assert (r["passed"], r["total"]) == (5, 5)


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
