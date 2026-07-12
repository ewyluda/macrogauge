import json

import pytest

from pipeline.engine import dcindex
from pipeline.models import Observation
from pipeline.store import vintage


def make_conn(tmp_path, rows, vintages=None):
    """rows: (series_code, obs_date, value); vintages: optional per-row vintage."""
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date=(vintages or {}).get((c, d), "2026-01-01"),
                       source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path / "store")
    return vintage.load(tmp_path / "store")


def write_basket(tmp_path, build, ops):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops}))
    return p


TWO_COMP_BUILD = [
    {"code": "steel", "label": "Steel", "group": "materials", "series": "ppi_steel", "weight": 0.6},
    {"code": "concrete", "label": "Concrete", "group": "materials", "series": "ppi_concrete", "weight": 0.4},
]
ONE_COMP_OPS = [
    {"code": "power", "label": "Power", "group": "power", "series": "eia_elec_ind_us", "weight": 1.0},
]
OPS_ROWS = [("eia_elec_ind_us", "2017-01-01", 10.0), ("eia_elec_ind_us", "2018-01-01", 10.5)]


def test_headline_yoy_is_weighted_own_obs_yoy(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    build = result["indexes"]["build"]
    assert build["as_of"] == "2018-01-01"
    # steel +10%, concrete +5% -> 0.6*10 + 0.4*5 = 8.0
    assert build["yoy"]["2018-01-01"] == pytest.approx(8.0)
    assert build["components"]["steel"]["yoy_pct"] == pytest.approx(10.0)
    assert build["components"]["concrete"]["yoy_pct"] == pytest.approx(5.0)
    assert build["components"]["steel"]["mode"] == "official"
    ops = result["indexes"]["ops"]
    assert ops["yoy"]["2018-01-01"] == pytest.approx(5.0)


def test_stale_series_carries_forward_no_weight_shift(tmp_path):
    # concrete stops in 2017-06; its last value must carry forward into the
    # headline at the grid end — NOT be dropped or renormalized away.
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2017-06-01", 220.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    build = result["indexes"]["build"]
    assert build["as_of"] == "2018-01-01"
    # rebase anchors concrete on 2018-01 fallback-first-month rules? No — concrete
    # has no 2018-01 obs, so rebase anchors on its FIRST month (2017-01): index
    # 2017-06 = 220/200*100 = 110, carried to 2018-01-01.
    assert build["index"]["2018-01-01"] == pytest.approx(0.6 * 100.0 + 0.4 * 110.0)
    # concrete's YoY is at its OWN last obs (2017-06-01, base missing -> None)
    assert build["components"]["concrete"]["last_obs"] == "2017-06-01"


def test_proxy_splice_and_gate(tmp_path):
    build = [{"code": "copper_wire", "label": "Copper", "group": "materials",
              "series": "ppi_copper_wire", "weight": 1.0, "live_proxy": "fmp_copper"}]
    rows = [
        ("ppi_copper_wire", "2017-01-01", 100.0), ("ppi_copper_wire", "2018-01-01", 100.0),
        ("fmp_copper", "2018-01-01", 50.0), ("fmp_copper", "2018-01-05", 55.0),
    ] + OPS_ROWS
    basket = write_basket(tmp_path, build, ONE_COMP_OPS)

    # (a) proxy point just arrived today and jumps 10% -> gate holds it one day
    conn = make_conn(tmp_path / "a", rows,
                     vintages={("fmp_copper", "2018-01-05"): "2018-01-05"})
    result = dcindex.run(conn, today="2018-01-05", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["components"]["copper_wire"]["mode"] == "official+proxy"
    assert b["index"]["2018-01-05"] == pytest.approx(100.0)  # held at prior value
    assert b["gate_flags"] == ["copper_wire@2018-01-05"]

    # (b) same data, not just-arrived -> spike passes through, spliced tail
    #     scale x rebase cancel: 100 * 55/50 = 110 exactly
    conn = make_conn(tmp_path / "b", rows)
    result = dcindex.run(conn, today="2018-01-05", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["index"]["2018-01-05"] == pytest.approx(110.0)
    assert b["gate_flags"] == []


def test_missing_series_raises_clear_error(tmp_path):
    conn = make_conn(tmp_path, OPS_ROWS)  # no build series data at all
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    with pytest.raises(ValueError):
        dcindex.run(conn, today="2018-01-15", basket_path=basket)


def test_parity_pinned_worked_example():
    # spec §6 pinned formula: mult = w x relative + (1 - w)
    out = dcindex.parity_rows(
        power={"ca": ("2026-05-01", 12.0)}, wage={"ca": ("2026-01-01", 2000.0)},
        nat_power=("2026-05-01", 10.0), nat_wage=("2026-01-01", 1600.0),
        w_labor=0.30, w_power=0.55)
    assert out["mode"] == "full"
    row = out["states"][0]
    assert row["state"] == "CA"
    assert row["power_rel"] == pytest.approx(1.2)
    assert row["ops_mult"] == pytest.approx(0.55 * 1.2 + 0.45)   # 1.11
    assert row["wage_rel"] == pytest.approx(1.25)
    assert row["build_mult"] == pytest.approx(0.30 * 1.25 + 0.70)  # 1.075
    assert row["power_asof"] == "2026-05-01" and row["wage_asof"] == "2026-01-01"


def test_parity_degrades_to_ops_only_without_wages():
    out = dcindex.parity_rows(
        power={"ca": ("2026-05-01", 12.0)}, wage={},
        nat_power=("2026-05-01", 10.0), nat_wage=None,
        w_labor=0.30, w_power=0.55)
    assert out["mode"] == "ops_only"
    row = out["states"][0]
    assert row["ops_mult"] == pytest.approx(1.11)
    assert row["wage_rel"] is None and row["build_mult"] is None


def test_parity_unavailable_without_national_power():
    out = dcindex.parity_rows(power={"ca": ("2026-05-01", 12.0)}, wage={},
                              nat_power=None, nat_wage=None,
                              w_labor=0.30, w_power=0.55)
    assert out["mode"] == "unavailable" and out["states"] == []


def test_parity_from_store_discovers_states(tmp_path):
    conn = make_conn(tmp_path, [
        ("eia_elec_ind_us", "2026-05-01", 10.0),
        ("eia_elec_ind_ca", "2026-05-01", 12.0),
        ("eia_elec_ind_va", "2026-04-01", 8.0),
        ("qcew_wage23_us", "2026-01-01", 1600.0),
        ("qcew_wage23_ca", "2026-01-01", 2000.0),
    ])
    # explicit tmp basket with known parity shares: w_labor 0.30, w_power 0.55
    build = [
        {"code": "labor", "label": "L", "group": "labor", "series": "ces_constr_ahe", "weight": 0.30},
        {"code": "rest", "label": "R", "group": "materials", "series": "ppi_steel", "weight": 0.70},
    ]
    ops = [
        {"code": "power", "label": "P", "group": "power", "series": "eia_elec_ind_us", "weight": 0.55},
        {"code": "ops_wages", "label": "W", "group": "ops_labor", "series": "ces_dp_ahe", "weight": 0.45},
    ]
    basket = write_basket(tmp_path, build, ops)
    out = dcindex.parity_from_store(conn, basket_path=basket)
    assert out["mode"] == "full"
    by_state = {r["state"]: r for r in out["states"]}
    assert set(by_state) == {"CA", "VA"}
    assert by_state["CA"]["build_mult"] == pytest.approx(1.075)     # 0.30 x 1.25 + 0.70
    assert by_state["VA"]["ops_mult"] == pytest.approx(0.55 * 0.8 + 0.45)
    assert by_state["VA"]["build_mult"] is None  # no VA wage row
