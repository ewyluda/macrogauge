import json

import pytest

from pipeline.engine import gauge
from pipeline.models import Observation
from pipeline.store import vintage

MINI = {"base_month": "2018-01", "components": [
    {"code": "shelter", "label": "Shelter", "weight": 0.6,
     "official_series": "OFF_SH", "live_blend": {"LIVE_SH": 1.0},
     "live_variants": ["gauge"]},
    {"code": "fuel", "label": "Fuel", "weight": 0.4,
     "official_series": "OFF_FU", "live_blend": {"LIVE_FU": 1.0},
     "live_variants": ["gauge", "tracker"]}]}

ROWS = [  # (series, obs_date, value)
    ("OFF_SH", "2018-01-01", 100.0), ("OFF_SH", "2019-01-01", 103.0),
    ("LIVE_SH", "2018-01-01", 50.0), ("LIVE_SH", "2019-01-01", 53.0),
    ("OFF_FU", "2018-01-01", 200.0), ("OFF_FU", "2019-01-01", 208.0),
    ("LIVE_FU", "2018-01-01", 10.0), ("LIVE_FU", "2019-01-01", 10.4)]

STALENESS = {"LIVE_SH": 75, "LIVE_FU": 21}


def seed(tmp_path, rows, vintage_date="2019-01-02"):
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date=vintage_date, source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(MINI))
    return vintage.load(tmp_path), bp


def test_two_variant_hand_computed(tmp_path):
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g, t = r["variants"]["gauge"], r["variants"]["tracker"]
    assert r["base_month"] == "2018-01"
    assert g["as_of"] == "2019-01-01" and t["as_of"] == "2019-01-01"
    # 365d from 2019-01-01 lands exactly on 2018-01-01 (2018 not a leap year)
    assert g["yoy"]["2019-01-01"] == pytest.approx(5.2)
    assert t["yoy"]["2019-01-01"] == pytest.approx(3.4)
    assert g["index"]["2018-01-01"] == pytest.approx(100.0)
    assert g["yoy"]["2018-06-01"] is None  # no 365d base inside the window
    assert g["components"]["shelter"]["mode"] == "live"
    assert t["components"]["shelter"]["mode"] == "bls_cf"
    assert g["components"]["shelter"]["yoy_pct"] == pytest.approx(6.0)
    assert g["components"]["fuel"]["yoy_pct"] == pytest.approx(4.0)
    assert g["components"]["fuel"]["end_value"] == pytest.approx(104.0)
    # coverage: both live blends fresh (4 days old vs 75/21 limits)
    assert g["coverage_pct"] == pytest.approx(100.0)
    assert t["coverage_pct"] == pytest.approx(40.0)
    assert g["gate_flags"] == []


def test_stale_live_source_lowers_coverage(tmp_path):
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-04-01", basket_path=bp, staleness=STALENESS)
    # 90 days after last obs: shelter (75d limit) and fuel (21d) both stale
    assert r["variants"]["gauge"]["coverage_pct"] == pytest.approx(0.0)
    # staleness affects coverage only — the index still publishes
    assert r["variants"]["gauge"]["yoy"]["2019-01-01"] == pytest.approx(5.2)


def test_gate_holds_spiking_arrival(tmp_path):
    # fuel's last live obs jumps +6% AND arrived today -> held at prior value
    rows = [row for row in ROWS if row[0] != "LIVE_FU"] + [
        ("LIVE_FU", "2018-01-01", 10.0), ("LIVE_FU", "2018-12-25", 10.0)]
    conn, bp = seed(tmp_path, rows)
    spike = [Observation(series_code="LIVE_FU", obs_date="2019-01-01", value=10.6,
                         vintage_date="2019-01-05", source="T", route="API")]
    vintage.append(spike, tmp_path)
    conn = vintage.load(tmp_path)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    assert g["gate_flags"] == ["fuel@2019-01-01"]
    assert g["components"]["fuel"]["end_value"] == pytest.approx(100.0)  # held


def test_missing_live_source_falls_back_to_bls_cf(tmp_path):
    rows = [row for row in ROWS if row[0] != "LIVE_SH"]
    conn, bp = seed(tmp_path, rows)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    assert g["components"]["shelter"]["mode"] == "bls_cf"
    assert g["yoy"]["2019-01-01"] == pytest.approx(0.6 * 3.0 + 0.4 * 4.0)
