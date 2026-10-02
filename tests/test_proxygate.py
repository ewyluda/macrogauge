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


def _nand(start="2021-01-01", end="2026-06-30", amp=0.35):
    """Smooth daily NAND path. amp=0.35: year-over-year growth mostly inside
    ±50% (the calm regime the switched rule carries through); amp=0.8: YoY
    swings to -75%/+190%, a memory-price shock regime like 2022 or 2026."""
    d0, d = date.fromisoformat(start), date.fromisoformat(start)
    out = {}
    while d <= date.fromisoformat(end):
        x = (d - d0).days / 365.0
        out[d.isoformat()] = 30.0 * math.exp(amp * math.sin(2 * math.pi * x / 3.1))
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


def _passthrough_world(lam=0.5, amp=0.8, nand_end="2026-06-30"):
    """PPI(M) = PPI(M-12) * (1 + lam * (W(mid M)/W(mid M - 365d) - 1)): the
    storage PPI inherits `lam` of NAND's like-month move."""
    nand = _nand(end=nand_end, amp=amp)
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
    assert g["regime_active"] is True and abs(g["proxy_yoy_pct"]) > 50
    # The grid pick sits below the true 0.5: the splice anchors at the
    # first-of-month print date while the world prices mid-month, an error
    # that big moves magnify and a damped λ absorbs. OLS recovers the truth.
    assert g["best_lambda"] in (0.25, 0.5)
    assert g["months_graded"] >= proxygate.MIN_MONTHS
    assert g["best_mae"] < g["carry_forward_mae"] and g["best_mae"] < g["zero_lambda_mae"]
    assert g["best_max"] <= g["carry_forward_max"]
    assert g["lambda_ols"] == pytest.approx(0.5, abs=0.05)
    # dcindex rides the tail at the gate's λ
    result = dcindex.run(conn, today="2026-06-30", basket_path=_basket(tmp_path))
    hw = result["indexes"]["hardware"]
    assert hw["components"]["storage"]["mode"] == "official+proxy"
    assert hw["as_of"] == "2026-06-30"
    assert hw["proxy_gates"]["storage"]["verdict"] == "PASS"


def test_gate_fails_and_index_is_official_only_when_the_tail_is_noise(tmp_path):
    # PPI on a steady +2%/yr trend, NAND in its shock regime: every λ>0
    # loses to carry-forward, so the storage component must not ride the tail.
    nand = _nand(amp=0.8)
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
    nand = {d: v for d, v in _nand(amp=0.8).items() if d >= "2026-02-15"}
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


def test_passing_gate_idles_while_nand_is_calm(tmp_path):
    # Same informative world, but spot runs on to 2026-10-31, when NAND is
    # only ~20% off its year-ago level: the backtest still passes, yet the
    # switched rule carries in that regime, so storage is official-only.
    ppi, nand = _passthrough_world(0.5, nand_end="2026-10-31")
    conn = _store(tmp_path, ppi, nand)
    g = proxygate.grade(conn, "ppi_storage", ("dramex_nand_mlc64",), 7)
    assert g["verdict"] == "PASS"
    assert g["regime_active"] is False and abs(g["proxy_yoy_pct"]) <= 50
    assert g["tail_active"] is False
    assert "until NAND moves" in g["note"]
    result = dcindex.run(conn, today="2026-10-31", basket_path=_basket(tmp_path))
    assert result["indexes"]["hardware"]["components"]["storage"]["mode"] == "official"


def test_calm_months_grade_as_carry_forward(tmp_path):
    # NAND never leaves ±25% YoY (amp=0.1): every switched λ>0 IS
    # carry-forward, so its MAE equals carry's exactly and the gate cannot
    # pass (it must strictly beat carry) however well NAND explains the PPI.
    ppi, nand = _passthrough_world(0.5, amp=0.1)
    conn = _store(tmp_path, ppi, nand)
    g = proxygate.grade(conn, "ppi_storage", ("dramex_nand_mlc64",), 7)
    assert g["months_graded"] >= proxygate.MIN_MONTHS
    assert g["best_mae"] == g["carry_forward_mae"]
    assert g["verdict"] == "FAIL" and g["tail_active"] is False


def test_proxy_yoy_reads_sparse_monthly_history_within_tolerance():
    live = {"2025-01-03": 10.0, "2025-02-02": 11.0, "2026-01-20": 20.0}
    # base lookup 2025-01-20 -> 2025-01-03 (17 days) ; now -> 2026-01-20
    assert proxygate.proxy_yoy(live, "2026-01-20") == pytest.approx(1.0)
    # base 2024-12-01 has nothing at/before it: None, never fabricated
    assert proxygate.proxy_yoy(live, "2025-12-01") is None
    # a target more than PROXY_TOLERANCE_DAYS past the last point: None
    assert proxygate.proxy_yoy(live, "2026-03-15") is None
    assert proxygate.regime_active(0.51) and proxygate.regime_active(-0.6)
    assert not proxygate.regime_active(0.5) and not proxygate.regime_active(None)


def test_monthly_archived_history_makes_the_gate_gradeable(tmp_path):
    # The real store after scripts/backfill_dramex_wayback.py: ~monthly
    # archived points, then daily live collection from 2026-02-15.
    ppi, daily = _passthrough_world(0.5)
    nand = {d: v for d, v in daily.items() if d >= "2026-02-15" or d.endswith("-02")}
    conn = _store(tmp_path, ppi, nand)
    g = proxygate.grade(conn, "ppi_storage", ("dramex_nand_mlc64",), 7)
    assert g["months_graded"] >= proxygate.MIN_MONTHS
    assert g["verdict"] == "PASS"
    result = dcindex.run(conn, today="2026-06-30", basket_path=_basket(tmp_path))
    assert result["indexes"]["hardware"]["components"]["storage"]["mode"] == "official+proxy"
