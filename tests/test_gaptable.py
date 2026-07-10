import json
from pathlib import Path

import pytest

from pipeline import basket
from pipeline.models import Observation
from pipeline.publish import gaptable, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"

MINI = {"base_month": "2018-01", "supercore_components": ["fuel"], "components": [
    {"code": "shelter", "label": "Shelter", "weight": 0.6, "pce_weight": 0.6,
     "official_series": "OFF_SH", "live_blend": {"LIVE_SH": 1.0},
     "live_variants": ["gauge"]},
    {"code": "fuel", "label": "Fuel", "weight": 0.4, "pce_weight": 0.4,
     "official_series": "OFF_FU"}]}

# official series need month & 12m/1m-prior rows for component_summary
OFF_ROWS = [("OFF_SH", "2018-01-01", 100.0), ("OFF_SH", "2018-12-01", 102.8),
            ("OFF_SH", "2019-01-01", 103.0),  # BLS shelter YoY = +3.0
            ("OFF_FU", "2018-01-01", 200.0), ("OFF_FU", "2018-12-01", 207.0),
            ("OFF_FU", "2019-01-01", 208.0)]  # BLS fuel YoY = +4.0


def seed(tmp_path):
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2019-01-02", source="T", route="API")
           for c, d, v in OFF_ROWS]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(MINI))
    _, comps = basket.load_basket(bp)
    return vintage.load(tmp_path), comps


def _variant(yoy_pct, as_of="2019-01-05", coverage=50.0):
    """Minimal variant stub — just enough for gaptable's variant_summary
    block (yoy at as_of, as_of, coverage_pct); rows only ever read gauge."""
    return {"index": {}, "yoy": {as_of: yoy_pct}, "as_of": as_of,
            "coverage_pct": coverage, "gate_flags": [], "components": {}}


RESULT = {"base_month": "2018-01", "variants": {
    "gauge": {"index": {}, "yoy": {"2019-01-05": 5.5}, "as_of": "2019-01-05",
              "coverage_pct": 60.0, "gate_flags": [],
              "components": {
                  "shelter": {"weight": 0.6, "mode": "live",
                              "yoy_pct": 6.04321, "end_value": 106.0},
                  "fuel": {"weight": 0.4, "mode": "bls_cf",
                           "yoy_pct": 4.0, "end_value": 104.0}}},
    "tracker": _variant(3.2, coverage=0.0),
    "col": _variant(5.4, coverage=55.0),
    "supercore": _variant(4.8, coverage=10.0),
    "pce": _variant(2.9, coverage=45.0)}}


def test_build_rows_and_contributions(tmp_path):
    conn, comps = seed(tmp_path)
    p = gaptable.build(RESULT, conn, comps, official_month="2019-01-01")
    assert p["as_of"] == "2019-01-05"
    assert p["official_month"] == "2019-01-01"
    assert len(p["rows"]) == 2
    shelter = p["rows"][0]  # biggest |contribution| first
    assert shelter["component"] == "shelter"
    assert shelter["mode"] == "live"
    assert shelter["ours_yoy_pct"] == 6.04
    assert shelter["bls_yoy_pct"] == 3.0
    # gap/contribution from UNROUNDED inputs: 6.04321-3.0=3.04321, x0.6=1.82593
    assert shelter["gap_pp"] == 3.04
    assert shelter["contribution_pp"] == 1.83
    fuel = p["rows"][1]
    assert fuel["gap_pp"] == 0.0 and fuel["contribution_pp"] == 0.0
    assert p["total_gap_pp"] == 1.83


def test_write_validates_against_schema(tmp_path):
    conn, comps = seed(tmp_path)
    path = gaptable.write(
        gaptable.build(RESULT, conn, comps, official_month="2019-01-01"),
        tmp_path, published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "gaptable.json"
    validate.validate_file(path, SCHEMAS / "gaptable.schema.json")


def test_variant_summary_has_all_five_variants(tmp_path):
    conn, comps = seed(tmp_path)
    p = gaptable.build(RESULT, conn, comps, official_month="2019-01-01")
    assert set(p["variants"]) == {"gauge", "col", "tracker", "supercore", "pce"}
    for name, v in p["variants"].items():
        assert set(v) == {"yoy_pct", "as_of", "coverage_pct"}
    assert p["variants"]["gauge"] == {"yoy_pct": 5.5, "as_of": "2019-01-05",
                                      "coverage_pct": 60.0}
