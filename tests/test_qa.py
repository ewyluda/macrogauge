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
