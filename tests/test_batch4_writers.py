"""Batch 4 writers (2026-09-03): rates, compute, housing, changes, and the
grocery wholesale block. Synthetic stores; schema validation on every
payload; the null-row contract (a missing series never raises)."""
import json
import math
from pathlib import Path

import pytest

from pipeline.collect import SourceResult
from pipeline.models import Observation
from pipeline.publish import changes, compute, grocery, housing, pulse, rates, validate
from pipeline.publish.util import delta_daily, nearest_on_or_before
from pipeline.registry import Series
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def _store(tmp_path, code_to_rows, source="FRED"):
    obs = [Observation(series_code=code, obs_date=d, value=v, vintage_date="2026-09-03",
                       source=source, route="API")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


# --- util ---------------------------------------------------------------

def test_delta_daily_points_and_window():
    obs = {"2026-08-01": 4.0, "2026-08-29": 4.3, "2026-09-01": 4.4}
    # a 1-day lookback resolves to as_of itself inside the ±3d window — the
    # inherited pct_change_daily convention; rates.py uses the prior obs for 1d
    assert delta_daily(obs, "2026-09-01", 1) == 0.0
    assert delta_daily(obs, "2026-09-01", 3) == 0.1          # exact 08-29
    assert delta_daily(obs, "2026-09-01", 31) == 0.4         # 08-01 exact
    assert nearest_on_or_before(obs, "2026-09-03") == 4.4
    assert nearest_on_or_before(obs, "2026-07-01") is None


# --- rates --------------------------------------------------------------

def test_rates_empty_store_publishes_null_blocks_and_validates(tmp_path):
    p = rates.build(_store(tmp_path, {}))
    assert [r["label"] for r in p["curve"]] == ["1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"]
    assert all(r["value"] is None for r in p["curve"])
    assert p["spreads"]["s2s10s"]["value"] is None
    assert p["liquidity"]["net_bn"] is None and p["liquidity"]["history"]["dates"] == []
    path = rates.write(p, tmp_path / "out", "2026-09-03T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "rates.schema.json")


def test_rates_spreads_units_and_history(tmp_path):
    conn = _store(tmp_path, {
        "DGS2": {"2025-09-02": 3.9, "2026-08-03": 4.2, "2026-09-02": 4.4},
        "DGS10": {"2025-09-02": 4.1, "2026-08-03": 4.6, "2026-09-02": 4.8},
        "T10YIE": {"2026-09-02": 2.3},
        "WALCL": {"2026-08-26": 6_730_912.0},          # millions
        "WTREGEN": {"2026-08-26": 950_736.0},          # millions
        "RRPONTSYD": {"2026-08-25": 0.7},              # billions, day before the weekly row
        "pmms_30yr": {"2026-09-03": 6.71},
    })
    p = rates.build(conn)
    s = p["spreads"]["s2s10s"]
    assert s["value"] == 0.4 and s["as_of"] == "2026-09-02"
    assert s["chg_30d_pp"] == 0.0      # 0.4 - (4.6-4.2)
    assert s["chg_1y_pp"] == 0.2       # 0.4 - (4.1-3.9)
    assert p["spreads"]["real_10y"]["value"] == 2.5
    liq = p["liquidity"]
    assert liq["walcl_bn"] == 6730.9 and liq["tga_bn"] == 950.7 and liq["rrp_bn"] == 0.7
    assert liq["net_bn"] == round(6730.912 - 950.736 - 0.7, 1)
    ten = [r for r in p["curve"] if r["code"] == "DGS10"][0]
    assert ten["chg_1y_pp"] == 0.7 and ten["value_1y_ago"] == 4.1
    assert ten["chg_1d_pp"] == 0.2  # vs the prior observation (08-03), not a window
    h = p["history"]
    assert h["dates"] == ["2025-09-02", "2026-08-03", "2026-09-02"]
    assert h["spread_2s10s"] == [0.2, 0.4, 0.4]
    assert p["mortgage"]["spread_to_10y_pp"] == round(6.71 - 4.8, 4)  # DGS10 read ≤7d before
    path = rates.write(p, tmp_path / "out", "2026-09-03T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "rates.schema.json")


# --- compute ------------------------------------------------------------

def test_compute_index_geometric_mean_renormalizes_and_rebases(tmp_path):
    days = ["2026-07-15", "2026-07-16", "2026-07-17"]
    rows = {}
    for key, base in (("gpt4o", 4.0), ("deepseek", 1.0), ("llama70b", 2.0)):
        rows[f"or_{key}_in"] = {d: base for d in days}
        rows[f"or_{key}_out"] = {d: base for d in days}
    # deepseek halves on day 3; llama missing on day 3
    rows["or_deepseek_in"]["2026-07-17"] = 0.5
    rows["or_deepseek_out"]["2026-07-17"] = 0.5
    del rows["or_llama70b_in"]["2026-07-17"]
    del rows["or_llama70b_out"]["2026-07-17"]
    conn = _store(tmp_path, rows, source="OPENROUTER")
    p = compute.build(conn)
    ti = p["token_index"]
    assert ti["base_date"] == "2026-07-15"
    assert ti["history"]["index"][0] == 100.0 and ti["history"]["members"][0] == 3
    # day 3 (chain-linked, registry 7d carry): llama's 07-16 price carries, so
    # 3 members link and the move is geomean(1, 0.5, 1) = 0.7937. (Pre-chain
    # this pinned a null: the fixed-base mean had no carry, so 2 < MIN_MEMBERS.)
    assert ti["history"]["index"][2] == pytest.approx(79.37, abs=1e-3)
    assert ti["history"]["members"][2] == 3
    # with no carry allowed, llama is absent -> 2 members < MIN_MEMBERS -> null
    ti0 = compute.build(conn, staleness={})["token_index"]  # unlisted -> default
    assert ti0["history"]["index"][2] == pytest.approx(79.37, abs=1e-3)
    ti0 = compute.build(conn, staleness={f"or_llama70b_{s}": 0 for s in ("in", "out")})["token_index"]
    assert ti0["history"]["index"][2] is None and ti0["history"]["members"][2] == 2
    models = {m["key"]: m for m in p["models"]}
    assert models["gpt4o"]["blended_usd_mtok"] == 4.0
    assert models["claude_sonnet"]["as_of"] is None  # never collected -> null row
    path = compute.write(p, tmp_path / "out", "2026-09-03T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "compute.schema.json")


def _gpu_store(tmp_path, prices):
    """prices: {code: {date: $/hr}} -> conn (VASTAI source for every row)."""
    return _store(tmp_path, prices, source="VASTAI")


NO_CARRY = {c: 0 for c, _ in compute.GPUS}


def test_gpu_index_membership_swing_does_not_move_the_level(tmp_path):
    # The 2026-09-24 -> 09-25 regression: every price unchanged, but the two
    # dearest SKUs (H200, sfcompute H100) are missing on day 2. The old
    # fixed-base mean re-averaged the survivors' levels-vs-base and jumped;
    # the chain averages day-over-day relatives of members on both days (all
    # 1.0) and stays flat. NO_CARRY makes the absence real (not carried).
    d1, d2, d0 = "2026-09-24", "2026-09-25", "2026-09-23"
    base = {"vast_h100_sxm": 2.0, "vast_h200": 3.0, "vast_a100_sxm": 1.0,
            "vast_rtx4090": 0.4, "sfc_h100": 2.5}
    moved = {"vast_h100_sxm": 1.8, "vast_h200": 3.3, "vast_a100_sxm": 1.1,
             "vast_rtx4090": 0.44, "sfc_h100": 2.75}
    prices = {c: {d0: base[c], d1: moved[c]} for c in base}
    for c in ("vast_h100_sxm", "vast_a100_sxm", "vast_rtx4090"):
        prices[c][d2] = moved[c]
    gi = compute.build(_gpu_store(tmp_path, prices), staleness=NO_CARRY)["gpu_index"]
    h = dict(zip(gi["history"]["dates"], gi["history"]["index"]))
    assert gi["base_date"] == d0
    assert h[d2] == h[d1]                       # no membership jump
    assert gi["history"]["members"] == [5, 5, 3]
    # d1's move is the geomean of all five relatives from d0
    rel = [moved[c] / base[c] for c in base]
    assert h[d1] == pytest.approx(100 * math.prod(rel) ** (1 / 5), abs=1e-3)


def test_gpu_index_permanent_exit_links_without_a_jump(tmp_path):
    # sfc_h100 is retired after 2026-09-24 (no data after). Within its 7-day
    # carry it links flat; after that it drops out — neither step moves the
    # level. The survivors' later moves still chain in.
    days = ([f"2026-09-{d:02d}" for d in range(20, 31)]
            + ["2026-10-01", "2026-10-02", "2026-10-03"])
    prices = {c: {d: 1.0 for d in days}
              for c in ("vast_h100_sxm", "vast_a100_sxm", "vast_rtx4090")}
    prices["sfc_h100"] = {d: 9.0 for d in days if d <= "2026-09-24"}
    prices["vast_h100_sxm"]["2026-10-03"] = 1.331   # +33.1% on the last day
    gi = compute.build(_gpu_store(tmp_path, prices),
                       staleness={c: 7 for c, _ in compute.GPUS})["gpu_index"]
    h = dict(zip(gi["history"]["dates"], gi["history"]["index"]))
    m = dict(zip(gi["history"]["dates"], gi["history"]["members"]))
    assert all(h[d] == 100.0 for d in days[:-1])   # carried, then gone: flat
    assert m["2026-10-01"] == 4 and m["2026-10-02"] == 3   # 09-24 + 7d carry
    assert h["2026-10-03"] == pytest.approx(100 * 1.331 ** (1 / 3), abs=1e-3)  # 110.0


def test_gpu_index_carried_member_books_its_move_on_arrival(tmp_path):
    # a member missing one day links flat that day (carried) and its full
    # move lands when its next price arrives — nothing is lost or doubled
    days = ["2026-09-01", "2026-09-02", "2026-09-03"]
    prices = {c: {d: 1.0 for d in days}
              for c in ("vast_h100_sxm", "vast_a100_sxm", "vast_rtx4090")}
    del prices["vast_rtx4090"]["2026-09-02"]
    prices["vast_rtx4090"]["2026-09-03"] = 1.331
    gi = compute.build(_gpu_store(tmp_path, prices),
                       staleness={c: 7 for c, _ in compute.GPUS})["gpu_index"]
    assert gi["history"]["index"] == [100.0, 100.0, pytest.approx(110.0, abs=1e-3)]
    assert gi["history"]["members"] == [3, 3, 3]


def test_gpu_index_thin_day_is_null_and_next_day_links_back(tmp_path):
    days = ["2026-09-01", "2026-09-02", "2026-09-03"]
    prices = {c: {d: 1.0 for d in days}
              for c in ("vast_h100_sxm", "vast_a100_sxm", "vast_rtx4090")}
    del prices["vast_a100_sxm"]["2026-09-02"]
    del prices["vast_rtx4090"]["2026-09-02"]
    for c in prices:
        prices[c]["2026-09-03"] = 1.2
    gi = compute.build(_gpu_store(tmp_path, prices), staleness=NO_CARRY)["gpu_index"]
    assert gi["history"]["index"][1] is None and gi["history"]["members"][1] == 1
    # 09-03 links to 09-01 (the last non-null level) over all three members
    assert gi["history"]["index"][2] == pytest.approx(120.0)
    assert gi["value"] == pytest.approx(120.0) and gi["as_of"] == "2026-09-03"


def test_gpu_index_chg_30d_compares_chained_levels(tmp_path):
    # 30 days apart: two members +10% each, a third absent on the later date
    # (no carry). Chained: 09-01 -> 10-01 links over the two present members
    # only, so the 30d change is +10%, not a membership artifact.
    prices = {"vast_h100_sxm": {"2026-09-01": 1.0, "2026-10-01": 1.1},
              "vast_a100_sxm": {"2026-09-01": 2.0, "2026-10-01": 2.2},
              "vast_rtx4090": {"2026-09-01": 0.5, "2026-10-01": 0.55},
              "vast_h200": {"2026-09-01": 5.0}}
    gi = compute.build(_gpu_store(tmp_path, prices), staleness=NO_CARRY)["gpu_index"]
    assert gi["value"] == pytest.approx(110.0)
    assert gi["chg_30d_pct"] == pytest.approx(10.0)


def test_compute_geometric_mean_value(tmp_path):
    days = ["2026-07-15", "2026-07-16"]
    rows = {}
    for key, b0, b1 in (("gpt4o", 4.0, 8.0), ("deepseek", 1.0, 0.5), ("llama70b", 2.0, 2.0)):
        rows[f"or_{key}_in"] = {days[0]: b0, days[1]: b1}
        rows[f"or_{key}_out"] = {days[0]: b0, days[1]: b1}
    p = compute.build(_store(tmp_path, rows, source="OPENROUTER"))
    # relatives 2.0, 0.5, 1.0 -> geometric mean 1.0 -> index 100 (arithmetic would say 116.7)
    assert p["token_index"]["history"]["index"][1] == 100.0
    assert p["gpu_index"]["base_date"] is None  # no GPU rows at all


# --- housing ------------------------------------------------------------

def test_housing_payment_and_affordability_history(tmp_path):
    assert round(housing.payment(100_000, 6.0), 2) == 599.55  # textbook 30y @ 6%
    conn = _store(tmp_path, {
        "zhvi_us": {"2018-01-01": 200_000.0, "2018-02-01": 202_000.0},
        "pmms_30yr": {"2018-01-04": 4.0, "2018-01-11": 4.2},  # Feb has no print -> carries Jan
        "CES0500000003": {"2018-01-01": 26.0, "2018-02-01": 26.1},
    })
    p = housing.build(conn)
    a = p["affordability"]
    assert a["history"]["months"] == ["2018-01-01", "2018-02-01"]
    assert a["history"]["rate_pct"] == [4.1, 4.1]
    assert a["history"]["price"] == [160_000, 161_600]
    assert a["income"] == round(26.1 * 2080 / 12)
    assert a["share_pct"] == round(housing.payment(161_600, 4.1) / (26.1 * 2080 / 12) * 100, 2)
    assert a["share_2018_01_pct"] == a["history"]["share_pct"][0]
    assert p["prices"]["case_shiller"]["value"] is None  # absent -> null measure
    path = housing.write(p, tmp_path / "out", "2026-09-03T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "housing.schema.json")


# --- grocery wholesale --------------------------------------------------

def test_grocery_wholesale_pairs_retail_yoy(tmp_path):
    conn = _store(tmp_path, {
        "APU0000708111": {"2025-06-01": 2.50, "2026-05-01": 3.90, "2026-06-01": 4.00},
        "usda_eggs_w": {"2025-06-02": 1.00, "2026-06-01": 1.50},   # 364d back = 2025-06-02
    }, source="BLS")
    series = [Series(code="APU0000708111", source="BLS", source_id="x",
                     name="Avg price: eggs, grade A, dozen", max_staleness_days=80)]
    p = grocery.build(conn, series)
    w = {r["code"]: r for r in p["wholesale"]}
    eggs = w["usda_eggs_w"]
    assert eggs["yoy_pct"] == 50.0 and eggs["retail_yoy_pct"] == 60.0
    assert eggs["spread_pp"] == 10.0
    assert w["usda_milk_w"]["value"] is None  # absent -> null row, still listed
    path = grocery.write(p, tmp_path / "out", "2026-09-03T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "grocery_basket.schema.json")


# --- changes + pulse prev ----------------------------------------------

def _write(out, name, payload):
    out.mkdir(parents=True, exist_ok=True)
    (out / name).write_text(json.dumps(payload))


def test_changes_first_run_has_null_prev_and_validates(tmp_path):
    out = tmp_path / "out"
    assert changes.read_previous(out) is None
    _write(out, "pulse.json", {"published_at": "T1", "gauge": {"yoy_pct": 3.0, "as_of": "2026-09-03"},
                               "tracker": {"yoy_pct": 3.6, "as_of": "2026-09-03"},
                               "official": {"yoy_pct": 3.4, "month": "2026-07-01"}})
    _write(out, "gaptable.json", {"variants": {"col": {"yoy_pct": 2.1, "as_of": "2026-09-03"}},
                                  "rows": [{"component": "fuel", "label": "Gasoline", "mode": "live",
                                            "ours_yoy_pct": 24.6, "bls_yoy_pct": 24.6}]})
    results = [SourceResult("AAA", True, 1, 1, None, "T"),
               SourceResult("EIA", False, 0, 0, "boom", "T")]
    p = changes.build(None, out, results, gate_flags=["fuel"])
    assert p["prev_published_at"] is None
    keys = {h["key"]: h for h in p["headline"]}
    assert keys["gauge"]["delta_pp"] is None and keys["col"]["value"] == 2.1
    assert "dc_build" not in keys  # datacenter.json absent -> no DC rows
    assert p["components"][0]["prev_yoy_pct"] is None
    assert p["sources_landed"] == [{"source": "AAA", "new_rows": 1}]
    assert p["sources_failed"] == ["EIA"] and p["gate_holds"] == ["fuel"]
    path = changes.write(p, out, "T1")
    validate.validate_file(path, SCHEMAS / "changes.schema.json")


def test_changes_diffs_against_previous_snapshot(tmp_path):
    out = tmp_path / "out"
    _write(out, "pulse.json", {"published_at": "T0", "gauge": {"yoy_pct": 2.9, "as_of": "2026-09-02"},
                               "tracker": {"yoy_pct": 3.6, "as_of": "2026-09-02"},
                               "official": {"yoy_pct": 3.5, "month": "2026-06-01"}})
    _write(out, "gaptable.json", {"variants": {}, "rows": [
        {"component": "fuel", "label": "Gasoline", "mode": "live", "ours_yoy_pct": 23.0, "bls_yoy_pct": 24.6}]})
    _write(out, "datacenter.json", {"indexes": {"build": {"headline_yoy_pct": 9.0, "as_of": "2026-09-02"},
                                                "ops": {"headline_yoy_pct": 4.8, "as_of": "2026-07-01"},
                                                "hardware": {"headline_yoy_pct": 20.2, "as_of": "2026-07-01"}}})
    prev = changes.read_previous(out)
    assert prev["published_at"] == "T0"
    # today's publish lands
    _write(out, "pulse.json", {"published_at": "T1", "gauge": {"yoy_pct": 3.0, "as_of": "2026-09-03"},
                               "tracker": {"yoy_pct": 3.6, "as_of": "2026-09-03"},
                               "official": {"yoy_pct": 3.4, "month": "2026-07-01"}})
    _write(out, "gaptable.json", {"variants": {}, "rows": [
        {"component": "fuel", "label": "Gasoline", "mode": "live", "ours_yoy_pct": 24.6, "bls_yoy_pct": 24.6}]})
    _write(out, "datacenter.json", {"indexes": {"build": {"headline_yoy_pct": 9.2, "as_of": "2026-09-03"},
                                                "ops": {"headline_yoy_pct": 4.8, "as_of": "2026-07-01"},
                                                "hardware": {"headline_yoy_pct": 20.2, "as_of": "2026-07-01"}}})
    p = changes.build(prev, out, [], None)
    keys = {h["key"]: h for h in p["headline"]}
    assert keys["gauge"]["delta_pp"] == 0.1 and keys["gauge"]["prev_as_of"] == "2026-09-02"
    assert keys["dc_build"]["delta_pp"] == 0.2 and keys["dc_ops"]["delta_pp"] == 0.0
    assert p["components"][0]["delta_pp"] == 1.6
    assert p["official"]["new_print"] is True and p["official"]["prev_month"] == "2026-06-01"
    assert p["prev_published_at"] == "T0"
    validate.validate_file(changes.write(p, out, "T1"), SCHEMAS / "changes.schema.json")


def test_pulse_carries_prev_reading():
    v = {"yoy": {"2026-09-03": 3.04}, "as_of": "2026-09-03", "coverage_pct": 42.6}
    gr = {"variants": {"gauge": v, "tracker": v}}
    cpi = {"yoy_pct": 3.36, "prev_yoy_pct": 3.53, "month": "2026-07-01"}
    p = pulse.build(gr, cpi, prev={"gauge": {"yoy_pct": 2.97, "as_of": "2026-09-02"}})
    assert p["gauge"]["prev_yoy_pct"] == 2.97 and p["gauge"]["prev_as_of"] == "2026-09-02"
    assert p["tracker"]["prev_yoy_pct"] is None
    p0 = pulse.build(gr, cpi)
    assert p0["gauge"]["prev_yoy_pct"] is None
