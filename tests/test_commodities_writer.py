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
        ["AI BUILD-OUT", "ENERGY & POWER", "METALS", "AGRICULTURE"]


def test_rows_reference_registered_codes():
    _, series = load_registry()
    codes = {s.code for s in series}
    for _, rows in commodities.GROUPS:
        for code, *_ in rows:
            assert code in codes


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
