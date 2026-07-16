import json
from pathlib import Path

from pipeline.publish import datacenter, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

DC_RESULT = {
    "base_month": "2018-01",
    "indexes": {
        "build": {
            "index": {"2017-06-01": 99.0, "2018-01-01": 100.0, "2018-06-01": 104.0},
            "yoy": {"2017-06-01": None, "2018-01-01": 2.0, "2018-06-01": 4.0},
            "as_of": "2018-06-01", "gate_flags": [],
            "components": {
                "steel": {"label": "Steel", "group": "materials", "weight": 0.6,
                          "mode": "official", "yoy_pct": 5.0, "last_obs": "2018-06-01"},
                "copper_wire": {"label": "Copper", "group": "materials", "weight": 0.4,
                                "mode": "official+proxy", "yoy_pct": None,
                                "last_obs": "2018-06-01"}}},
        "ops": {
            "index": {"2018-01-01": 100.0}, "yoy": {"2018-01-01": None},
            "as_of": "2018-01-01", "gate_flags": ["power@2018-01-01"],
            "components": {
                "power": {"label": "Power", "group": "power", "weight": 1.0,
                          "mode": "official", "yoy_pct": 3.0, "last_obs": "2018-01-01"}}},
        "hardware": {
            "index": {"2018-01-01": 100.0, "2018-06-01": 112.0},
            "yoy": {"2018-01-01": None, "2018-06-01": 12.0},
            "as_of": "2018-06-01", "gate_flags": [],
            "components": {
                "storage": {"label": "Storage", "group": "storage", "weight": 1.0,
                            "mode": "official", "yoy_pct": 12.0,
                            "last_obs": "2018-06-01"}}},
    },
    "hardware_gap": [
        {"code": "storage", "label": "Storage PPI", "series": "ppi_storage",
         "in_basket": True, "yoy_pct": 12.345, "last_obs": "2018-06-01"},
        {"code": "cpi_computers", "label": "CPI computers", "series": "cpi_computers",
         "in_basket": False, "yoy_pct": None, "last_obs": "2018-05-01"}]}
PARITY = {"mode": "ops_only", "w_labor": 0.3, "w_power": 0.55,
          "national": {"power": {"value": 10.0, "as_of": "2026-05-01"}, "wage": None},
          "states": [{"state": "CA", "power_rel": 1.2, "ops_mult": 1.11,
                      "power_asof": "2026-05-01", "wage_rel": None,
                      "build_mult": None, "wage_asof": None}]}
SOURCE_IDS = {"ppi_storage": "PCU334112334112", "cpi_computers": "CUUR0000SEEE01"}
CONSTRUCTION = {"as_of": "2026-05-01", "unit": "$M",
                "latest_saar": 61000.04, "yoy_pct": 30.239, "yoy_asof": "2026-05-01",
                "vs_2014_avg": 39.812,
                "months": ["2014-01-01", "2026-05-01"],
                "saar": [1500.0, 61000.04], "real": [None, 41200.049]}
POWER = {"tail": {"active": True, "smooth_days": 7,
                  "hubs": ["caiso_sp15_da", "miso_indiana_da"],
                  "transform": "year_ratio", "passthrough": 0.5,
                  "nowcast": {"implied_cents_kwh": 8.91, "yoy_pct": 4.27,
                              "asof": "2026-07-14"}},
        "hubs": [{"code": "caiso_sp15_da", "label": "CAISO SP15 (day-ahead)",
                  "latest": 44.749, "asof": "2026-07-14", "unit": "$/MWh"},
                 {"code": "ice_pjm_west", "label": "PJM Western Hub (ICE wtd avg)",
                  "latest": 39.0, "asof": "2026-06-28", "unit": "$/MWh"}],
        "henry_hub": {"code": "eia_henry_hub", "label": "Henry Hub natural gas",
                      "latest": 2.8261, "asof": "2026-07-13", "unit": "$/MMBtu"},
        "capacity_auction": {
            "source": "PJM RPM Base Residual Auction results (pjm.com)",
            "asof": "2025-12-17",
            "rows": [{"delivery_year": "2024/25", "price_mw_day": 28.92},
                     {"delivery_year": "2025/26", "price_mw_day": 269.92}],
            "multiple": 9.3, "years_span": 1}}


def test_build_publishes_from_2018_with_contributions():
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, CONSTRUCTION, POWER)
    b = payload["indexes"]["build"]
    assert b["dates"][0] == "2018-01-01"          # 2017 grid is internal only
    assert b["headline_yoy_pct"] == 4.0
    comps = {c["code"]: c for c in b["components"]}
    assert comps["steel"]["contribution_pp"] == 3.0        # 0.6 x 5.0
    assert comps["copper_wire"]["contribution_pp"] is None
    assert payload["parity"]["mode"] == "ops_only"
    assert payload["group_labels"]["materials"] == "Materials"
    gap = {r["code"]: r for r in payload["hardware_gap"]}
    assert gap["storage"]["source_id"] == "PCU334112334112"
    assert gap["storage"]["yoy_pct"] == 12.35          # rounded 2dp
    assert gap["storage"]["in_basket"] is True
    assert gap["cpi_computers"]["yoy_pct"] is None
    assert payload["indexes"]["hardware"]["headline_yoy_pct"] == 12.0
    c = payload["construction"]
    assert c["latest_saar"] == 61000.0 and c["yoy_pct"] == 30.2
    assert c["vs_2014_avg"] == 39.8
    assert c["real"] == [None, 41200.0]
    assert len(c["months"]) == len(c["saar"]) == len(c["real"])
    p = payload["power"]
    assert p["tail"] == POWER["tail"]
    assert p["tail"]["nowcast"]["implied_cents_kwh"] == 8.91
    hubs = {h["code"]: h for h in p["hubs"]}
    assert hubs["caiso_sp15_da"]["latest"] == 44.75          # rounded 2dp
    assert hubs["ice_pjm_west"]["latest"] == 39.0
    assert p["henry_hub"]["latest"] == 2.83                  # rounded 2dp
    assert p["henry_hub"]["code"] == "eia_henry_hub"
    assert p["capacity_auction"] == POWER["capacity_auction"]


def test_written_file_validates_against_schema(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, CONSTRUCTION, POWER)
    path = datacenter.write(payload, tmp_path, published_at="2026-07-12T12:00:00Z")
    assert path.name == "datacenter.json"
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")
    assert json.loads(path.read_text())["published_at"] == "2026-07-12T12:00:00Z"


def test_null_construction_validates(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, None, None)
    assert payload["construction"] is None
    assert payload["power"] is None
    path = datacenter.write(payload, tmp_path, published_at="2026-07-15T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")


def test_power_null_henry_hub_validates(tmp_path):
    # a hub has data but Henry Hub does not yet (bootstrap): henry_hub must
    # publish as null, not be omitted or coerced to a placeholder object.
    power = {**POWER, "henry_hub": None}
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, CONSTRUCTION, power)
    assert payload["power"]["henry_hub"] is None
    path = datacenter.write(payload, tmp_path, published_at="2026-07-15T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")


def test_power_deferred_tail_validates(tmp_path):
    # wave-4 option B: no live_proxy_blend configured on ops power means
    # power_block publishes a deferred (inactive, nullable smooth_days,
    # empty hubs) tail. The panel (hubs/henry_hub/capacity_auction) is
    # unaffected and keeps publishing.
    power = {**POWER, "tail": {"active": False, "smooth_days": None, "hubs": []},
             "capacity_auction": {**POWER["capacity_auction"],
                                  "multiple": None, "years_span": None}}
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, CONSTRUCTION, power)
    assert payload["power"]["tail"] == {"active": False, "smooth_days": None, "hubs": []}
    path = datacenter.write(payload, tmp_path, published_at="2026-07-15T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")
