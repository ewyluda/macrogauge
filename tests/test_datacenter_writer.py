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


def test_build_publishes_from_2018_with_contributions():
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, CONSTRUCTION)
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


def test_written_file_validates_against_schema(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, CONSTRUCTION)
    path = datacenter.write(payload, tmp_path, published_at="2026-07-12T12:00:00Z")
    assert path.name == "datacenter.json"
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")
    assert json.loads(path.read_text())["published_at"] == "2026-07-12T12:00:00Z"


def test_null_construction_validates(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, None)
    assert payload["construction"] is None
    path = datacenter.write(payload, tmp_path, published_at="2026-07-15T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")
