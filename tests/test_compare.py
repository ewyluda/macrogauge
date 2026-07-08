from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import compare, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"

# Official CPI: 2018 YoYs computable for Jan/Feb/Mar (bases in 2017)
CPI_ROWS = [("2017-01-01", 100.0), ("2017-02-01", 100.5), ("2017-03-01", 101.0),
            ("2018-01-01", 102.0), ("2018-02-01", 103.0), ("2018-03-01", 104.5)]
# official YoY: Jan +2.0, Feb +2.487..., Mar +3.465...


def seed(tmp_path):
    obs = [Observation(series_code="CPIAUCNS", obs_date=d, value=v,
                       vintage_date="2018-04-01", source="FRED", route="API")
           for d, v in CPI_ROWS]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def variant(yoy_by_month):
    dates = sorted(yoy_by_month)
    return {"index": {d: 100.0 for d in dates}, "yoy": dict(yoy_by_month),
            "as_of": dates[-1], "coverage_pct": 40.0, "gate_flags": [],
            "components": {}}


RESULT = {"base_month": "2018-01", "variants": {
    "gauge": variant({"2018-01-01": 2.5, "2018-02-01": 3.0, "2018-03-01": 4.0}),
    "tracker": variant({"2018-01-01": 2.1, "2018-02-01": 2.6, "2018-03-01": 3.4})}}


def test_build_months_arrays_and_validation(tmp_path):
    conn = seed(tmp_path)
    p = compare.build(RESULT, conn)
    assert p["months"] == ["2018-01-01", "2018-02-01", "2018-03-01"]
    assert p["official_yoy_pct"][0] == 2.0
    assert p["gauge_yoy_pct"] == [2.5, 3.0, 4.0]
    assert p["tracker_yoy_pct"] == [2.1, 2.6, 3.4]
    v = p["validation"]["tracker"]
    assert v["window"] == "2018-01..2018-03"
    assert v["corr"] is not None and 0.9 <= v["corr"] <= 1.0
    # official YoY: Feb 103/100.5-1 = 2.4876%, Mar 104.5/101-1 = 3.4653%
    # gaps: |2.1-2.0|, |2.6-2.4876|, |3.4-3.4653| -> mean 0.0926 -> 0.09
    assert v["mean_abs_gap_pp"] == 0.09


def test_missing_month_is_null_and_short_window_corr_null(tmp_path):
    conn = seed(tmp_path)
    result = {"base_month": "2018-01", "variants": {
        "gauge": variant({"2018-01-01": 2.5}),
        "tracker": variant({"2018-01-01": 2.1})}}
    p = compare.build(result, conn)
    assert p["gauge_yoy_pct"] == [2.5, None, None]
    assert p["validation"]["gauge"]["corr"] is None  # one pair — no correlation


def test_write_validates_against_schema(tmp_path):
    conn = seed(tmp_path)
    path = compare.write(compare.build(RESULT, conn), tmp_path,
                         published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "compare.json"
    validate.validate_file(path, SCHEMAS / "compare.schema.json")
