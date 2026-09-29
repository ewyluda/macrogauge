"""NAND spot -> storage PPI tail gate (engine/proxygate.py, 2026-09-28)."""
import json
import math
from datetime import date, timedelta

import pytest

from pipeline import dc_basket
from pipeline.engine import dcindex, proxygate
from pipeline.models import Observation
from pipeline.publish import dc_grades
from pipeline.store import vintage

GATED_STORAGE = {"code": "storage", "label": "Storage", "group": "storage",
                 "series": "ppi_storage", "weight": 1.0,
                 "live_proxy_blend": ["dramex_nand_mlc64"], "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "year_ratio", "live_proxy_gate": "backtest"}
BUILD = [{"code": "steel", "label": "Steel", "group": "materials", "series": "ppi_steel",
          "weight": 1.0}]
OPS = [{"code": "power", "label": "Power", "group": "power", "series": "eia_elec_ind_us",
        "weight": 1.0}]


def _basket(tmp_path, storage=GATED_STORAGE):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": BUILD, "ops": OPS, "hardware": [storage],
                             "hardware_gap": []}))
    return p


def _nand(start="2021-01-01", end="2026-06-30"):
    """Smooth daily NAND path whose year-over-year growth swings ±25%."""
    d0, d = date.fromisoformat(start), date.fromisoformat(start)
    out = {}
    while d <= date.fromisoformat(end):
        x = (d - d0).days / 365.0
        out[d.isoformat()] = 30.0 * math.exp(0.35 * math.sin(2 * math.pi * x / 3.1))
        d += timedelta(days=1)
    return out


def _months(start="2021-01-01", end="2026-06-01"):
    y, m = int(start[:4]), int(start[5:7])
    out = []
    while f"{y:04d}-{m:02d}-01" <= end:
        out.append(f"{y:04d}-{m:02d}-01")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _store(tmp_path, ppi: dict[str, float], nand: dict[str, float]):
    rows = ([("ppi_storage", d, v) for d, v in ppi.items()]
            + [("dramex_nand_mlc64", d, v) for d, v in nand.items()]
            + [("ppi_steel", "2021-01-01", 100.0), ("ppi_steel", "2026-06-01", 110.0),
               ("eia_elec_ind_us", "2021-01-01", 10.0), ("eia_elec_ind_us", "2026-06-01", 11.0)])
    vintage.append([Observation(c, d, v, "2026-07-01", "T", "API") for c, d, v in rows],
                   tmp_path / "store")
    return vintage.load(tmp_path / "store")


def _passthrough_world(lam=0.5):
    """PPI(M) = PPI(M-12) * (1 + lam * (W(mid M)/W(mid M - 365d) - 1)): the
    storage PPI inherits `lam` of NAND's like-month move."""
    nand = _nand()
    ppi = {}
    for m in _months():
        prior = f"{int(m[:4]) - 1}{m[4:]}"
        if prior not in ppi:
            ppi[m] = 100.0
            continue
        mid = date.fromisoformat(m[:8] + "15")
        ratio = nand[mid.isoformat()] / nand[(mid - timedelta(days=365)).isoformat()]
        ppi[m] = ppi[prior] * (1 + lam * (ratio - 1))
    return ppi, nand


def test_gate_passes_and_recovers_passthrough_when_the_tail_is_informative(tmp_path):
    ppi, nand = _passthrough_world(0.5)
    conn = _store(tmp_path, ppi, nand)
    g = proxygate.grade(conn, "ppi_storage", ("dramex_nand_mlc64",), 7)
    assert g["verdict"] == "PASS" and g["tail_active"] is True
    assert g["best_lambda"] == 0.5
    assert g["months_graded"] >= proxygate.MIN_MONTHS
    assert g["best_mae"] < g["carry_forward_mae"] and g["best_mae"] < g["zero_lambda_mae"]
    assert g["lambda_ols"] == pytest.approx(0.5, abs=0.05)
    # dcindex rides the tail at the gate's λ
    result = dcindex.run(conn, today="2026-06-30", basket_path=_basket(tmp_path))
    hw = result["indexes"]["hardware"]
    assert hw["components"]["storage"]["mode"] == "official+proxy"
    assert hw["as_of"] == "2026-06-30"
    assert hw["proxy_gates"]["storage"]["verdict"] == "PASS"


def test_gate_fails_and_index_is_official_only_when_the_tail_is_noise(tmp_path):
    # PPI on a steady +2%/yr trend, NAND swinging ±25% YoY: every λ>0 loses
    # to zero pass-through, so the storage component must not ride the tail.
    nand = _nand()
    ppi = {m: 100.0 * 1.02 ** (i / 12) for i, m in enumerate(_months())}
    conn = _store(tmp_path, ppi, nand)
    g = proxygate.grade(conn, "ppi_storage", ("dramex_nand_mlc64",), 7)
    assert g["verdict"] == "FAIL" and g["tail_active"] is False
    result = dcindex.run(conn, today="2026-06-30", basket_path=_basket(tmp_path))
    hw = result["indexes"]["hardware"]
    assert hw["components"]["storage"]["mode"] == "official"
    assert hw["as_of"] == "2026-06-01"


def test_gate_insufficient_with_under_a_year_of_spot_history(tmp_path):
    # the real store on 2026-09-28: NAND spot only since 2026-07-15
    ppi, _ = _passthrough_world(0.5)
    nand = {d: v for d, v in _nand().items() if d >= "2026-02-15"}
    conn = _store(tmp_path, ppi, nand)
    g = proxygate.grade(conn, "ppi_storage", ("dramex_nand_mlc64",), 7)
    assert g["verdict"] == "INSUFFICIENT" and g["months_graded"] == 0
    assert g["best_lambda"] is None and g["lambda_ols"] is None
    assert "official-only" in g["note"]
    result = dcindex.run(conn, today="2026-06-30", basket_path=_basket(tmp_path))
    assert result["indexes"]["hardware"]["components"]["storage"]["mode"] == "official"


def test_published_storage_nowcast_is_the_gate_dcindex_uses(tmp_path):
    ppi, nand = _passthrough_world(0.5)
    conn = _store(tmp_path, ppi, nand)
    published = dc_grades.storage_nowcast(conn, _basket(tmp_path))
    assert published == proxygate.grade(conn, "ppi_storage", ("dramex_nand_mlc64",), 7)


def test_gate_config_validation(tmp_path):
    with_lambda = {**GATED_STORAGE, "live_proxy_passthrough": 0.5}
    with pytest.raises(ValueError, match="drop live_proxy_passthrough"):
        dc_basket.load_baskets(_basket(tmp_path, with_lambda))
    level = {k: v for k, v in GATED_STORAGE.items() if k != "live_proxy_transform"}
    with pytest.raises(ValueError, match="requires year_ratio"):
        dc_basket.load_baskets(_basket(tmp_path, level))
    with pytest.raises(ValueError, match="unknown live_proxy_gate"):
        dc_basket.load_baskets(_basket(tmp_path, {**GATED_STORAGE, "live_proxy_gate": "always"}))
