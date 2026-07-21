import json
from pathlib import Path

import pytest

from pipeline import capacity


def test_real_config_loads_and_orcl_is_hyperscaler():
    cfg = capacity.load_capacity()
    assert len(cfg["companies"]) == 18
    orcl = next(c for c in cfg["companies"] if c["t"] == "ORCL")
    assert orcl["role"] == "hyperscaler" and orcl["dupe"] is None
    assert all("px" not in c and "cap" not in c for c in cfg["companies"])


def _mini(tmp_path, **overrides):
    base = {"schema_version": 1, "as_of_curated": "2026-07-21", "note": "n",
            "basis": {}, "tenants": [], "geo": [], "geo_unmapped": [],
            "geo_note": "g",
            "companies": [{"t": "AAA", "n": "Aaa", "role": "neocloud",
                           "dupe": None, "private": False, "valuation_b": None,
                           "confidence": "filed", "op": 1, "con": 2, "plan": 3,
                           "nd": 0.5, "bk": None, "econ": {}, "sites": [],
                           "src": []}]}
    base.update(overrides)
    p = tmp_path / "capacity.json"
    p.write_text(json.dumps(base))
    return p


def test_duplicate_ticker_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"].append(dict(cfg["companies"][0]))
    p = tmp_path / "dup.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="duplicate"):
        capacity.load_capacity(p)


def test_bad_role_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["role"] = "benchmark"  # retired role
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="role"):
        capacity.load_capacity(p)


def test_negative_mw_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["op"] = -5
    p = tmp_path / "neg.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="op"):
        capacity.load_capacity(p)


def test_private_without_valuation_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["private"] = True
    p = tmp_path / "priv.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="valuation_b"):
        capacity.load_capacity(p)


def test_unknown_tenant_or_geo_ticker_raises(tmp_path):
    p = _mini(tmp_path, tenants=[["Someone", "ZZZ", 100, "terms"]])
    with pytest.raises(ValueError, match="ZZZ"):
        capacity.load_capacity(p)


def test_registry_cross_check(tmp_path):
    p = _mini(tmp_path)
    with pytest.raises(ValueError, match="fmp_cap"):
        capacity.load_capacity(p, registry_codes={"something_else"})
    capacity.load_capacity(p, registry_codes={"fmp_cap_aaa", "fmp_px_aaa"})


def test_real_config_passes_registry_cross_check():
    from pipeline import registry
    _, series = registry.load_registry()
    capacity.load_capacity(registry_codes={s.code for s in series})
