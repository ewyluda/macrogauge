import json
import tempfile
from pathlib import Path

import pytest

from pipeline import basket as basket_mod
from pipeline.engine import gauge
from pipeline.models import Observation
from pipeline.store import vintage

MINI = {"base_month": "2018-01", "supercore_components": ["fuel"], "components": [
    {"code": "shelter", "label": "Shelter", "weight": 0.6, "pce_weight": 0.6,
     "official_series": "OFF_SH", "live_blend": {"LIVE_SH": 1.0},
     "live_variants": ["gauge"]},
    {"code": "fuel", "label": "Fuel", "weight": 0.4, "pce_weight": 0.4,
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


def test_gate_protects_col_payment_override(tmp_path):
    """Task 12 review fix: col's shelter_owned rides the marginal-buyer
    payment index (zhvi_us + pmms_30yr/mnd_30y_d), NOT its configured
    live_blend (zori_us/aptlist_us here) -- the gate's arrival check must
    look at the override's REAL underlying sources, or a >5% one-day spike
    in mnd_30y_d (a daily scrape, the glitch-prone class the gate exists for)
    would never be seen as "just arrived" and would sail through ungated.

    shelter_owned's official/live_blend history gives a splice scale of
    exactly 1.0 (OFF_SH and the payment index's own rebase anchor are both
    100.0 at the splice point) -- so the held (pre-spike) value is provably
    100.0 regardless of the exact payment math, which is what we assert."""
    mini = {"base_month": "2018-01", "supercore_components": ["fuel"], "components": [
        {"code": "shelter_owned", "label": "Shelter (owned)", "weight": 0.6,
         "pce_weight": 0.6, "official_series": "OFF_SH",
         "live_blend": {"zori_us": 0.5, "aptlist_us": 0.3},
         "live_variants": ["col"]},
        {"code": "fuel", "label": "Fuel", "weight": 0.4, "pce_weight": 0.4,
         "official_series": "OFF_FU", "live_blend": {"LIVE_FU": 1.0},
         "live_variants": ["gauge", "tracker"]}]}
    rows = [
        ("OFF_SH", "2018-01-01", 100.0), ("OFF_SH", "2019-01-01", 103.0),
        ("OFF_FU", "2018-01-01", 200.0), ("OFF_FU", "2019-01-01", 208.0),
        ("zhvi_us", "2018-01-01", 300000.0),
        ("pmms_30yr", "2018-12-28", 6.0)]
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2019-01-02", source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(mini))
    today = "2019-01-05"
    # today's mnd_30y_d scrape: rate more than doubles (6.0 -> 14.0) ->
    # payment index jumps far more than 5% -- and it just arrived today.
    spike = [Observation(series_code="mnd_30y_d", obs_date=today, value=14.0,
                         vintage_date=today, source="T", route="API")]
    vintage.append(spike, tmp_path)
    conn = vintage.load(tmp_path)
    r = gauge.run(conn, today=today, basket_path=bp)
    col = r["variants"]["col"]
    assert col["gate_flags"] == [f"shelter_owned@{today}"]
    assert col["components"]["shelter_owned"]["end_value"] == pytest.approx(100.0)


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
    mini = {"base_month": "2018-01", "supercore_components": ["sticky"], "components": [
        {"code": "sticky", "label": "Sticky", "weight": 0.5, "pce_weight": 0.5,
         "official_series": "OFF_ST"},
        {"code": "live", "label": "Live", "weight": 0.5, "pce_weight": 0.5,
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


def test_components_expose_daily_index_arrays(tmp_path):
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    fuel = r["variants"]["gauge"]["components"]["fuel"]
    # ours: LIVE_FU 10 -> 10.4 rebased = 100 -> 104, filled daily
    assert fuel["daily_index"]["2018-01-01"] == pytest.approx(100.0)
    assert fuel["daily_index"]["2018-06-15"] == pytest.approx(100.0)  # filled
    assert fuel["daily_index"]["2019-01-01"] == pytest.approx(104.0)
    # official: OFF_FU 200 -> 208 rebased = 100 -> 104
    assert fuel["official_daily_index"]["2019-01-01"] == pytest.approx(104.0)


def test_lead_shifted_obs_cannot_future_date_as_of(tmp_path):
    """Fix 1 regression (Task 9 review): a component with a config lead_days
    shift (blend.shift_days, wired in gauge.py) can have its latest
    engine-view observation land AFTER `today` -- e.g. a raw store obs of
    2018-12-27 shifted +30d becomes 2019-01-26, which is in the future
    relative to today=2019-01-05. Pre-fix, `end = max(max(c) for c in
    built.values())` took that shifted future date as the published grid end,
    so as_of (and every published date-keyed series) landed 21 days ahead of
    today. Fixed: `end` is clamped at `today`, and each component's own_end is
    its last observation AT OR BEFORE that clamp -- the future-shifted point
    stays in `built` and enters the grid naturally once a later run's `today`
    catches up to it."""
    mini = {"base_month": "2018-01", "supercore_components": ["fuel"], "components": [
        {"code": "shelter", "label": "Shelter", "weight": 0.6, "pce_weight": 0.6,
         "official_series": "OFF_SH", "live_blend": {"LIVE_SH": 1.0},
         "live_variants": ["gauge"]},
        {"code": "fuel", "label": "Fuel", "weight": 0.4, "pce_weight": 0.4,
         "official_series": "OFF_FU", "live_blend": {"LIVE_FU": 1.0},
         "live_variants": ["gauge", "tracker"],
         "lead_days": {"LIVE_FU": 30}}]}
    rows = [
        ("OFF_SH", "2018-01-01", 100.0), ("OFF_SH", "2019-01-01", 103.0),
        ("LIVE_SH", "2018-01-01", 50.0), ("LIVE_SH", "2019-01-01", 53.0),
        ("OFF_FU", "2018-01-01", 200.0), ("OFF_FU", "2019-01-01", 208.0),
        # LIVE_FU's raw store dates, shifted +30d by lead_days:
        #   2017-12-01 -> 2017-12-31, 2018-01-01 -> 2018-01-31,
        #   2018-12-01 -> 2018-12-31 (own_end after clamp: like-month base
        #   2017-12-31 gives yoy = (10.3/9.8 - 1)*100),
        #   2018-12-27 -> 2019-01-26 (BEYOND today=2019-01-05 -- must not
        #   become as_of).
        ("LIVE_FU", "2017-12-01", 9.8), ("LIVE_FU", "2018-01-01", 10.0),
        ("LIVE_FU", "2018-12-01", 10.3), ("LIVE_FU", "2018-12-27", 10.35)]
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2019-01-02", source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(mini))
    conn = vintage.load(tmp_path)
    today = "2019-01-05"
    r = gauge.run(conn, today=today, basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    EXPECTED_FUEL_YOY = (10.3 / 9.8 - 1) * 100  # ~= 5.102040816326525

    assert g["as_of"] == today  # clamped -- NOT the shifted 2019-01-26
    assert g["yoy"][today] is not None  # headline yoy at as_of computes
    # fuel's yoy is at its own last obs <= today (2018-12-31), not the
    # future-shifted 2019-01-26 (which would give a different, wrong value)
    assert g["components"]["fuel"]["yoy_pct"] == pytest.approx(EXPECTED_FUEL_YOY)

    published_series = [
        g["index"], g["yoy"],
        g["components"]["fuel"]["daily_index"],
        g["components"]["fuel"]["own_yoy_daily"],
        g["components"]["fuel"]["official_daily_index"],
        g["components"]["fuel"]["official_own_yoy_daily"],
        g["components"]["shelter"]["daily_index"],
        g["components"]["shelter"]["own_yoy_daily"]]
    for series_dict in published_series:
        assert all(d <= today for d in series_dict)


def test_components_carry_own_yoy_daily(tmp_path):
    """Every component exposes its own-obs YoY (ours and official) as daily
    forward-filled series covering the grid end."""
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    for code, entry in g["components"].items():
        assert "own_yoy_daily" in entry, code
        assert "official_own_yoy_daily" in entry, code
        end = g["as_of"]
        assert end in entry["own_yoy_daily"], code
        assert end in entry["official_own_yoy_daily"], code


def _store_with_two_years():
    """Real 14-component basket (config/basket.json), ~2.5 years of monthly
    official-series data for every component -- enough for own-obs YoY across
    the whole grid. No live sources are seeded: every component resolves
    bls_cf (empty per-source dicts are falsy, so variants.build_component's
    `any(live_sources.values())` guard is False) and the CoL payment override
    degrades to its configured market-rent blend request, which also comes
    back empty -- a designed degradation (Task 12 brief note), not a bug.
    These three tests only assert variant-set membership, the supercore
    renormalization identity, and pce_weight wiring -- all hold regardless of
    live/bls_cf mode."""
    _, comps = basket_mod.load_basket()
    months = []
    y, m = 2017, 1
    while (y, m) <= (2019, 6):
        months.append(f"{y}-{m:02d}-01")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    obs = []
    for i, comp in enumerate(comps):
        for j, d in enumerate(months):
            obs.append(Observation(series_code=comp.official_series, obs_date=d,
                                   value=100.0 + i + 0.1 * j,
                                   vintage_date="2019-06-02", source="T", route="API"))
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        vintage.append(obs, tmp)
        return vintage.load(tmp)


def test_five_variants_published():
    conn = _store_with_two_years()
    result = gauge.run(conn, today="2026-07-01")
    assert set(result["variants"]) == {"gauge", "col", "tracker", "supercore", "pce"}


def test_supercore_is_renormalized_subset():
    conn = _store_with_two_years()
    result = gauge.run(conn, today="2026-07-01")
    sc = result["variants"]["supercore"]
    assert set(sc["components"]) == set(basket_mod.load_supercore_components())
    # headline() renormalizes by total weight; hand-check one date:
    # supercore index at as_of == sum(w_i * idx_i)/sum(w_i) over subset
    d = sc["as_of"]
    comps = sc["components"]
    manual = (sum(e["weight"] * e["daily_index"][d] for e in comps.values())
              / sum(e["weight"] for e in comps.values()))
    assert abs(sc["index"][d] - manual) < 1e-9


def test_pce_uses_pce_weights():
    conn = _store_with_two_years()
    result = gauge.run(conn, today="2026-07-01")
    _, comps = basket_mod.load_basket()
    pce_w = {c.code: c.pce_weight for c in comps}
    for code, entry in result["variants"]["pce"]["components"].items():
        assert entry["weight"] == pce_w[code]
