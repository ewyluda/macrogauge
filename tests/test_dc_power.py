import json

import pytest

from pipeline import dc_power

REGISTRY_CODES = {"caiso_sp15_da", "miso_indiana_da", "ice_pjm_west", "eia_henry_hub"}


def test_load_real_config():
    cfg = dc_power.load()
    assert [h.code for h in cfg.hubs] == ["caiso_sp15_da", "miso_indiana_da", "ice_pjm_west"]
    assert cfg.henry_hub.code == "eia_henry_hub"
    assert cfg.henry_hub.label == "Henry Hub natural gas"
    assert cfg.capacity_auction["source"].startswith("PJM RPM Base Residual Auction")
    assert cfg.capacity_auction["asof"] == "2025-12-17"
    rows = cfg.capacity_auction["rows"]
    assert len(rows) == 4
    assert rows[0] == {"delivery_year": "2024/25", "price_mw_day": 28.92}
    assert all(isinstance(r["price_mw_day"], (int, float)) for r in rows)


OK_HUBS = [{"code": "caiso_sp15_da", "label": "CAISO SP15"}]
OK_HENRY = {"code": "eia_henry_hub", "label": "Henry Hub"}
OK_CAP = {"source": "PJM", "asof": "2025-12-17",
          "rows": [{"delivery_year": "2024/25", "price_mw_day": 28.92}]}


def _write(tmp_path, hubs=None, henry=None, capacity=None):
    p = tmp_path / "dc_power.json"
    p.write_text(json.dumps({"hubs": hubs if hubs is not None else OK_HUBS,
                             "henry_hub": henry or OK_HENRY,
                             "capacity_auction": capacity if capacity is not None else OK_CAP}))
    return p


def test_unknown_hub_code_rejected(tmp_path):
    p = _write(tmp_path, hubs=[{"code": "nope", "label": "Nope"}])
    with pytest.raises(ValueError, match="unknown series code"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def test_unknown_henry_hub_code_rejected(tmp_path):
    p = _write(tmp_path, henry={"code": "nope", "label": "Nope"})
    with pytest.raises(ValueError, match="unknown series code"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def test_empty_capacity_rows_rejected(tmp_path):
    p = _write(tmp_path, capacity={"source": "PJM", "asof": "2025-12-17", "rows": []})
    with pytest.raises(ValueError, match="non-empty"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def test_non_numeric_price_rejected(tmp_path):
    p = _write(tmp_path, capacity={"source": "PJM", "asof": "2025-12-17",
                                   "rows": [{"delivery_year": "2024/25", "price_mw_day": "28.92"}]})
    with pytest.raises(ValueError, match="numeric"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def test_duplicate_hub_codes_rejected(tmp_path):
    p = _write(tmp_path, hubs=[{"code": "caiso_sp15_da", "label": "A"},
                               {"code": "caiso_sp15_da", "label": "B"}])
    with pytest.raises(ValueError, match="duplicate"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)
