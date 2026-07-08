from pathlib import Path

from pipeline.publish import gauge_daily, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"


def variant():
    return {"index": {"2017-12-31": 99.881, "2018-01-01": 100.004,
                      "2018-01-02": 100.126},
            "yoy": {"2017-12-31": None, "2018-01-01": 2.4567,
                    "2018-01-02": None},
            "as_of": "2018-01-02", "coverage_pct": 40.5, "gate_flags": [],
            "components": {}}


RESULT = {"base_month": "2018-01",
          "variants": {"gauge": variant(), "tracker": variant()}}


def test_build_clips_to_publish_start_and_rounds():
    p = gauge_daily.build(RESULT)
    g = p["variants"]["gauge"]
    assert p["rebase"] == "2018-01=100"
    assert g["dates"] == ["2018-01-01", "2018-01-02"]  # 2017 clipped
    assert g["index"] == [100.0, 100.13]
    assert g["yoy_pct"] == [2.46, None]
    assert len(g["dates"]) == len(g["index"]) == len(g["yoy_pct"])


def test_write_validates_against_schema(tmp_path):
    path = gauge_daily.write(gauge_daily.build(RESULT), tmp_path,
                             published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "gauge_daily.json"
    validate.validate_file(path, SCHEMAS / "gauge_daily.schema.json")
