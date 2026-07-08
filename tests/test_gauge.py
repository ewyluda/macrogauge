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


def test_component_yoy_at_own_last_obs_not_grid_end(tmp_path):
    # fuel's live data lags (ends 2018-12-01); shelter extends the grid to
    # 2019-01-01. Fuel YoY must be Dec-vs-Dec (its own as-of), not a
    # forward-filled Jan-vs-Jan.
    #
    # Hand-derivation (traced through the real engine chain):
    #   official OFF_FU rebased on 2018-01 (anchor=200.0 @ 2018-01-01):
    #       {2018-01-01: 100.0, 2019-01-01: 104.0}
    #   live LIVE_FU rebased on 2018-01 (anchor=10.0 @ 2018-01-01):
    #       {2017-12-01: 98.0, 2018-01-01: 100.0, 2018-12-01: 103.0}
    #   splice: live's first date is 2017-12-01, strictly BEFORE official's
    #       first date (2018-01-01) -> no official point at/before t0 ->
    #       scale = 1.0 (blend.splice's no-prior fallback), output is
    #       all-live: {2017-12-01: 98.0, 2018-01-01: 100.0, 2018-12-01: 103.0}
    #   re-anchor to 2018-01 (anchor is already 100.0 there) -> unchanged.
    #   fuel's own_end = max(built["fuel"]) = 2018-12-01 -- its own last
    #       obs, NOT the grid end 2019-01-01 (which belongs to shelter).
    #   365d back from 2018-12-01 lands exactly on 2017-12-01 (no Feb 29
    #       crossed), which IS present in fuel's daily-filled series
    #       (grid start 2017-01-01) -> base=98.0, value=103.0.
    #   yoy = (103.0/98.0 - 1) * 100 = (10.3/9.8 - 1) * 100 ~= 5.10204082
    rows = [r for r in ROWS if r[0] != "LIVE_FU"] + [
        ("LIVE_FU", "2017-12-01", 9.8), ("LIVE_FU", "2018-01-01", 10.0),
        ("LIVE_FU", "2018-12-01", 10.3)]
    conn, bp = seed(tmp_path, rows)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    EXPECTED = (10.3 / 9.8 - 1) * 100  # ~= 5.102040816326525
    assert g["as_of"] == "2019-01-01"  # grid still ends at shelter's last obs
    assert g["components"]["fuel"]["yoy_pct"] == pytest.approx(EXPECTED)
    # end_value is unchanged: still sampled at grid end, forward-filled
    assert g["components"]["fuel"]["end_value"] == pytest.approx(103.0)


def test_missing_live_source_falls_back_to_bls_cf(tmp_path):
    rows = [row for row in ROWS if row[0] != "LIVE_SH"]
    conn, bp = seed(tmp_path, rows)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    assert g["components"]["shelter"]["mode"] == "bls_cf"
    assert g["yoy"]["2019-01-01"] == pytest.approx(0.6 * 3.0 + 0.4 * 4.0)


def test_bls_cf_component_yoy_equals_official_yoy(tmp_path):
    # tracker's shelter is bls_cf (shelter's live_variants is ["gauge"] only)
    # -- a carried-forward component's YoY must equal its official series'
    # own YoY: OFF_SH 100 (2018-01-01) -> 103 (2019-01-01) = +3.0%
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    t = r["variants"]["tracker"]
    assert t["components"]["shelter"]["mode"] == "bls_cf"
    assert t["components"]["shelter"]["yoy_pct"] == pytest.approx(3.0)


def test_headline_yoy_no_between_print_decay(tmp_path):
    # The between-print sawtooth (spec 1c §3): sticky's last print is
    # 2018-05; the live component extends the grid to 2018-06-20. The base
    # year has a June jump (100 -> 110), so a grid-end LEVEL ratio compares
    # May-2018 against June-2017 (-2.27% headline). The headline must
    # instead carry sticky's own May-vs-May YoY (+5%) forward: +2.5%.
    mini = {"base_month": "2018-01", "components": [
        {"code": "sticky", "label": "Sticky", "weight": 0.5,
         "official_series": "OFF_ST"},
        {"code": "live", "label": "Live", "weight": 0.5,
         "official_series": "OFF_LV", "live_blend": {"LIVE_LV": 1.0},
         "live_variants": ["gauge"]}]}
    rows = [
        ("OFF_ST", "2017-01-01", 100.0), ("OFF_ST", "2017-05-01", 100.0),
        ("OFF_ST", "2017-06-01", 110.0), ("OFF_ST", "2018-01-01", 110.0),
        ("OFF_ST", "2018-05-01", 105.0),
        ("OFF_LV", "2017-01-01", 100.0), ("OFF_LV", "2018-01-01", 100.0),
        ("LIVE_LV", "2017-01-01", 50.0), ("LIVE_LV", "2018-01-01", 50.0),
        ("LIVE_LV", "2018-06-20", 50.0)]
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2018-06-21", source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(mini))
    conn = vintage.load(tmp_path)
    r = gauge.run(conn, today="2018-06-22", basket_path=bp,
                  staleness={"LIVE_LV": 75})
    g = r["variants"]["gauge"]
    assert g["as_of"] == "2018-06-20"
    # sticky: rebased on 2018-01 anchor 110 -> 2017-05 = 90.909,
    # 2018-05 = 95.4545 -> own YoY +5.0%, carried to grid end.
    # live: flat -> 0%. headline = .5*5 + .5*0 = 2.5
    assert g["yoy"]["2018-06-20"] == pytest.approx(2.5)
