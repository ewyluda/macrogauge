from pathlib import Path

from pipeline.publish import qa, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

FRESH = {"series_code": "CPIAUCNS", "month": "2026-05-01",
         "yoy_pct": 2.69, "prev_yoy_pct": 2.5, "as_of": "2026-07-07"}


def test_all_green_when_fresh():
    r = qa.run_checks(FRESH, today="2026-07-07")
    assert (r["passed"], r["total"]) == (2, 2)
    assert all(c["pass"] for c in r["checks"])


def test_stale_headline_fails():
    r = qa.run_checks(FRESH, today="2026-10-01")  # 153 days after 2026-05-01
    by_name = {c["name"]: c for c in r["checks"]}
    assert by_name["headline_current"]["pass"] is False
    assert r["passed"] == 1


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
    assert (r["passed"], r["total"]) == (4, 4)


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
