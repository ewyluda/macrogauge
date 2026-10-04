import json

import pytest

from pipeline import dc_power

REGISTRY_CODES = {"caiso_sp15_da", "miso_indiana_da", "ice_pjm_west", "eia_henry_hub"}


def test_load_real_config():
    cfg = dc_power.load()
    assert [h.code for h in cfg.hubs] == ["ice_pjm_west", "ercot_north_da", "miso_indiana_da",
                                         "spp_north_da", "caiso_sp15_da", "ice_palo_verde",
                                         "ice_midc", "nyiso_west_da", "ice_mass_hub"]
    assert all(h.grid and h.region and h.product for h in cfg.hubs)
    assert cfg.henry_hub.code == "eia_henry_hub"
    assert cfg.henry_hub.label == "Henry Hub natural gas"
    assert cfg.capacity_auction["source"].startswith("PJM RPM Base Residual Auction")
    assert cfg.capacity_auction["asof"] == "2026-07-14"  # 2028/29 BRA
    rows = cfg.capacity_auction["rows"]
    assert len(rows) == 5
    assert rows[-1] == {"delivery_year": "2028/29", "price_mw_day": 325.0}
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


def test_out_of_order_delivery_years_rejected(tmp_path):
    p = _write(tmp_path, capacity={"source": "PJM", "asof": "2025-12-17",
                                   "rows": [{"delivery_year": "2026/27", "price_mw_day": 333.44},
                                            {"delivery_year": "2024/25", "price_mw_day": 28.92}]})
    with pytest.raises(ValueError, match="ascending"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def test_duplicate_delivery_years_rejected(tmp_path):
    p = _write(tmp_path, capacity={"source": "PJM", "asof": "2025-12-17",
                                   "rows": [{"delivery_year": "2024/25", "price_mw_day": 28.92},
                                            {"delivery_year": "2024/25", "price_mw_day": 269.92}]})
    with pytest.raises(ValueError, match="ascending"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def test_non_string_delivery_year_rejected(tmp_path):
    p = _write(tmp_path, capacity={"source": "PJM", "asof": "2025-12-17",
                                   "rows": [{"delivery_year": 2024, "price_mw_day": 28.92}]})
    with pytest.raises(ValueError, match="delivery_year"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def test_duplicate_hub_codes_rejected(tmp_path):
    p = _write(tmp_path, hubs=[{"code": "caiso_sp15_da", "label": "A"},
                               {"code": "caiso_sp15_da", "label": "B"}])
    with pytest.raises(ValueError, match="duplicate"):
        dc_power.load(p, registry_codes=REGISTRY_CODES)


def _write_full(tmp_path, **extra):
    p = tmp_path / "dc_power.json"
    p.write_text(json.dumps({"hubs": OK_HUBS, "henry_hub": OK_HENRY, "capacity_auction": OK_CAP, **extra}))
    return p


MKT = {"iso": "MISO", "name": "PRA", "product": "annualized", "status": "auction", "note": "",
       "source": "MISO", "source_url": "https://www.misoenergy.org/x", "asof": "2026-04-28",
       "rows": [{"period": "2025/26", "price_mw_day": 217.0}, {"period": "2026/27", "price_mw_day": 126.19}]}


def test_real_config_carries_markets_and_tariffs():
    cfg = dc_power.load()
    assert {m["iso"] for m in cfg.capacity_markets} >= {"PJM", "MISO", "ISO-NE", "NYISO", "ERCOT"}
    assert len(cfg.tariffs) >= 10
    assert all(t["source_url"].startswith("https://") for t in cfg.tariffs)


def test_market_rows_must_ascend(tmp_path):
    bad = {**MKT, "rows": list(reversed(MKT["rows"]))}
    with pytest.raises(ValueError, match="ascending"):
        dc_power.load(_write_full(tmp_path, capacity_markets=[bad]), registry_codes=REGISTRY_CODES)


def test_no_auction_market_cannot_list_prices(tmp_path):
    bad = {**MKT, "iso": "ERCOT", "status": "none"}
    with pytest.raises(ValueError, match="no capacity auction"):
        dc_power.load(_write_full(tmp_path, capacity_markets=[bad]), registry_codes=REGISTRY_CODES)


def test_tariff_needs_confidence_and_https_source(tmp_path):
    t = {k: "x" for k in ("utility", "state", "grid", "tariff", "status", "min_take", "term",
                          "threshold", "pipeline", "source")}
    t.update(source_url="http://insecure", asof="2026-10-04", confidence="filed")
    with pytest.raises(ValueError, match="https"):
        dc_power.load(_write_full(tmp_path, tariffs=[t]), registry_codes=REGISTRY_CODES)
    t.update(source_url="https://ok", confidence="rumor")
    with pytest.raises(ValueError, match="confidence"):
        dc_power.load(_write_full(tmp_path, tariffs=[t]), registry_codes=REGISTRY_CODES)
