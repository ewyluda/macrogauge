"""Tests for pipeline/publish/commodities.py — commodities.json grouped market prices."""
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import commodities, validate
from pipeline.registry import load_registry
from pipeline.store import vintage

SCHEMA = Path(__file__).parent.parent / "schemas" / "commodities.schema.json"


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="FMP", route="API")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_group_order_pinned(tmp_path):
    p = commodities.build(_store_with(tmp_path, {}))
    assert [g["group"] for g in p["groups"]] == \
        ["AI BUILD INPUTS", "ENERGY & POWER", "PRECIOUS METALS", "AGRICULTURE"]


def test_each_series_appears_once():
    codes = [code for _, rows in commodities.GROUPS for code, *_ in rows]
    assert len(codes) == len(set(codes))       # copper/aluminum no longer twice


def test_rows_reference_registered_codes():
    _, series = load_registry()
    codes = {s.code for s in series}
    for _, rows in commodities.GROUPS:
        for code, *_ in rows:
            assert code in codes or code == commodities.PJM_CAPACITY   # curated, not a series


def test_row_values_yoy_and_spark(tmp_path):
    conn = _store_with(tmp_path, {
        "fmp_copper": {"2025-07-18": 5.0, "2026-07-17": 6.0, "2026-07-20": 6.35},
        "fmp_gold": {"2026-07-20": 4012.1}})  # no year-ago base -> null yoy
    rows = {r["code"]: r for g in commodities.build(conn)["groups"]
            for r in g["rows"]}
    cu = rows["fmp_copper"]
    assert cu["value"] == 6.35 and cu["as_of"] == "2026-07-20"
    # base 2025-07-20 has no obs; Fri 2025-07-18 within the ±3d window
    assert cu["yoy_pct"] == 27.0
    assert cu["spark"] == [5.0, 6.0, 6.35]
    au = rows["fmp_gold"]
    assert au["yoy_pct"] is None and au["value"] == 4012.1
    assert au["unit"] == "$/oz"


def test_missing_series_publishes_null_row(tmp_path):
    # a new writer must never be able to take down the publish block
    rows = {r["code"]: r for g in commodities.build(_store_with(tmp_path, {}))["groups"]
            for r in g["rows"]}
    assert rows["dramex_ddr5_16g"] == {
        "code": "dramex_ddr5_16g", "label": "DDR5 16Gb spot", "unit": "$",
        "value": None, "as_of": None, "yoy_pct": None, "chg_30d_pct": None,
        "spark": []}


def test_spark_capped_at_60_obs(tmp_path):
    rows_in = {f"2026-{m:02d}-{d:02d}": 100.0 + m + d
               for m in range(1, 7) for d in range(1, 29)}
    conn = _store_with(tmp_path, {"fmp_wti": rows_in})
    wti = {r["code"]: r for g in commodities.build(conn)["groups"]
           for r in g["rows"]}["fmp_wti"]
    assert len(wti["spark"]) == 60
    assert wti["spark"][-1] == wti["value"]


def test_written_file_validates_against_schema(tmp_path):
    conn = _store_with(tmp_path, {
        "fmp_copper": {"2026-07-20": 6.35},
        "vast_h100_sxm": {"2026-07-20": 2.0}})
    path = commodities.write(commodities.build(conn), tmp_path,
                             published_at="2026-07-20T15:00:00Z")
    validate.validate_file(path, SCHEMA)


def test_missing_yoy_gets_a_dated_stand_in(tmp_path):
    conn = _store_with(tmp_path, {
        # first collected under a year ago: change since the first reading
        "dramex_ddr5_16g": {"2026-07-15": 50.0, "2026-10-07": 60.0},
        # sparse history: nearest year-ago reading 10 days off -> dated stand-in
        "dramex_nand_mlc64": {"2025-09-22": 10.0, "2026-10-02": 40.0},
        # a true YoY exists: no stand-in
        "fmp_copper": {"2025-10-07": 5.0, "2026-10-07": 6.0}})
    rows = {r["code"]: r for g in commodities.build(conn, capacity_markets=[])["groups"] for r in g["rows"]}
    assert rows["dramex_ddr5_16g"]["yoy_pct"] is None
    assert rows["dramex_ddr5_16g"]["chg_alt"] == {"pct": 20.0, "label": "since Jul 15, 2026"}
    assert rows["dramex_nand_mlc64"]["chg_alt"] == {"pct": 300.0, "label": "vs Sep 22, 2025"}
    assert "chg_alt" not in rows["fmp_copper"] and rows["fmp_copper"]["yoy_pct"] == 20.0


def test_pjm_capacity_row_is_auction_to_auction(tmp_path):
    markets = [{"iso": "PJM", "asof": "2026-07-14", "rows": [
        {"period": "2027/28", "price_mw_day": 333.44}, {"period": "2028/29", "price_mw_day": 325.0}]}]
    p = commodities.build(_store_with(tmp_path, {}), capacity_markets=markets)
    row = {r["code"]: r for g in p["groups"] for r in g["rows"]}[commodities.PJM_CAPACITY]
    assert (row["label"], row["value"], row["as_of"]) == ("PJM capacity, auction clearing (2028/29)", 325.0, "2026-07-14")
    assert row["chg_alt"] == {"pct": -2.53, "label": "vs 2027/28 auction"}
    assert row["spark"] == [333.44, 325.0] and row["yoy_pct"] is None
    assert row["spark_span"] == "2027/28–2028/29 auctions"
    # no PJM market (or a broken config): a null row, never a failed publish
    empty = {r["code"]: r for g in commodities.build(_store_with(tmp_path / "e", {}), capacity_markets=[])["groups"]
             for r in g["rows"]}[commodities.PJM_CAPACITY]
    assert empty["value"] is None and "chg_alt" not in empty
    path = commodities.write(p, tmp_path, published_at="2026-10-07T15:00:00Z")
    validate.validate_file(path, SCHEMA)


def test_spark_span_states_the_period_each_sparkline_covers(tmp_path):
    conn = _store_with(tmp_path, {
        "fmp_copper": {"2026-07-15": 5.0, "2026-10-07": 6.0},            # daily: same year
        "ppi_steel": {"2021-09-01": 418.0, "2026-08-01": 381.2}})        # monthly: years
    rows = {r["code"]: r for g in commodities.build(conn, capacity_markets=[])["groups"] for r in g["rows"]}
    assert rows["fmp_copper"]["spark_span"] == "Jul 15 – Oct 7, 2026"
    assert rows["ppi_steel"]["spark_span"] == "Sep 2021 – Aug 2026"
