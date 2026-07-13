from pathlib import Path

import pytest

from pipeline.publish import pulse, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"


def variant(yoy, as_of="2026-07-06", cov=40.5):
    return {"index": {as_of: 105.0}, "yoy": {as_of: yoy}, "as_of": as_of,
            "coverage_pct": cov, "gate_flags": [], "components": {}}


GAUGE_RESULT = {"base_month": "2018-01",
                "variants": {"gauge": variant(2.412345),
                             "tracker": variant(2.351111, cov=6.5)}}
CPI = {"series_code": "CPIAUCNS", "month": "2026-05-01",
       "yoy_pct": 2.398765, "prev_yoy_pct": 2.3, "as_of": "2026-07-06"}


def test_build_rounds_and_computes_gap():
    p = pulse.build(GAUGE_RESULT, CPI,
                     next_print={"date": "2026-07-14", "reference_month": "2026-06"})
    assert p["gauge"] == {"yoy_pct": 2.41, "as_of": "2026-07-06",
                          "coverage_pct": 40.5}
    assert p["tracker"]["yoy_pct"] == 2.35
    assert p["official"] == {"yoy_pct": 2.4, "prev_yoy_pct": 2.3,
                             "month": "2026-05-01"}
    # gap from UNROUNDED values, then rounded: 2.412345-2.398765 = 0.01358 -> 0.01
    assert p["gap_pp"] == 0.01
    # tracker gap is published, not left for the site to subtract from a
    # possibly different print: 2.351111-2.398765 = -0.047654 -> -0.05
    assert p["tracker_gap_pp"] == -0.05
    assert p["next_print"] == {"date": "2026-07-14", "reference_month": "2026-06"}


def test_write_validates_against_schema(tmp_path):
    payload = pulse.build(GAUGE_RESULT, CPI,
                           next_print={"date": "2026-07-14", "reference_month": "2026-06"})
    path = pulse.write(payload, tmp_path, published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "pulse.json"
    validate.validate_file(path, SCHEMAS / "pulse.schema.json")


def test_next_print_none_is_published_as_null(tmp_path):
    payload = pulse.build(GAUGE_RESULT, CPI, next_print=None)
    assert payload["next_print"] is None
    path = pulse.write(payload, tmp_path, published_at="2026-07-08T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "pulse.schema.json")
