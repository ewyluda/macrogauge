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


ONE_COMP_HW = [
    {"code": "hw", "label": "HW", "group": "compute", "series": "ppi_steel", "weight": 1.0},
]


def write_basket(tmp_path, build, ops, hardware=None, gap=None):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops,
                             "hardware": hardware or ONE_COMP_HW,
                             "hardware_gap": gap or []}))
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
    basket = write_basket(tmp_path, build, ONE_COMP_OPS,
                          hardware=[{"code": "hw", "label": "HW", "group": "compute",
                                     "series": "ppi_copper_wire", "weight": 1.0}])

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


def test_official_print_not_gated_when_proxy_tail_is_empty(tmp_path):
    # splice_anchored drops proxy points <= the last official print, so when
    # the proxy has nothing newer, `last` IS an official print. A proxy
    # vintage correction arriving today for that exact date must NOT let the
    # gate hold a legitimate >5% official month-over-month move — official
    # data is trusted, the gate confines the proxy tail only.
    build = [{"code": "copper_wire", "label": "Copper", "group": "materials",
              "series": "ppi_copper_wire", "weight": 1.0, "live_proxy": "fmp_copper"}]
    rows = [
        ("ppi_copper_wire", "2017-12-01", 100.0), ("ppi_copper_wire", "2018-01-01", 100.0),
        ("ppi_copper_wire", "2018-02-01", 110.0),  # legitimate +10% print
        ("fmp_copper", "2018-01-15", 50.0), ("fmp_copper", "2018-02-01", 55.0),
    ] + OPS_ROWS
    basket = write_basket(tmp_path, build, ONE_COMP_OPS,
                          hardware=[{"code": "hw", "label": "HW", "group": "compute",
                                     "series": "ppi_copper_wire", "weight": 1.0}])
    conn = make_conn(tmp_path, rows,
                     vintages={("fmp_copper", "2018-02-01"): "2018-02-15"})
    result = dcindex.run(conn, today="2018-02-15", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["gate_flags"] == []
    assert b["index"]["2018-02-01"] == pytest.approx(110.0)  # not held at 100


def test_dormant_proxy_labels_official_and_changes_nothing(tmp_path):
    # proxy rows exist but ALL post-date the last official print: splice
    # returns official-only, mode must NOT advertise a tail, no gate flags.
    build = [{"code": "copper_wire", "label": "Copper", "group": "materials",
              "series": "ppi_copper_wire", "weight": 1.0,
              "live_proxy": "fmp_copper"}]
    rows = [
        ("ppi_copper_wire", "2017-01-01", 100.0),
        ("ppi_copper_wire", "2018-01-01", 100.0),
        ("fmp_copper", "2018-01-10", 50.0), ("fmp_copper", "2018-01-11", 55.0),
    ] + OPS_ROWS
    conn = make_conn(tmp_path, rows)
    # hardware default (ONE_COMP_HW -> ppi_steel) has no rows in this test;
    # point it at a series that's already in `rows` so only the "build"
    # basket under test is exercised, matching the sibling proxy tests above.
    basket = write_basket(tmp_path, build, ONE_COMP_OPS,
                          hardware=[{"code": "hw", "label": "HW", "group": "compute",
                                     "series": "ppi_copper_wire", "weight": 1.0}])
    result = dcindex.run(conn, today="2018-01-12", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["components"]["copper_wire"]["mode"] == "official"
    assert b["gate_flags"] == []
    assert max(b["index"]) == "2018-01-01"      # no tail beyond the print


BLEND_OPS = [
    {"code": "power", "label": "Power", "group": "power", "series": "eia_elec_ind_us",
     "weight": 1.0, "live_proxy_blend": ["caiso_sp15_da", "miso_indiana_da"],
     "live_proxy_smooth_days": 2},
]
BUILD_ROWS = [
    ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
    ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
]


def test_blend_proxy_worked_example_and_smoothed_tail(tmp_path):
    # two hub series + monthly official: caiso has a point AT the official's
    # last print (anchors the splice) plus a tail; miso is missing the
    # middle day (exercises hub_mean's "one hub missing a day carries") and
    # has no point at the print itself (exercises trailing_mean's gap-shrink
    # at the first tail date).
    rows = BUILD_ROWS + [
        ("eia_elec_ind_us", "2017-01-01", 10.0), ("eia_elec_ind_us", "2018-01-01", 10.5),
        ("caiso_sp15_da", "2018-01-01", 50.0), ("caiso_sp15_da", "2018-01-02", 52.0),
        ("caiso_sp15_da", "2018-01-03", 54.0),
        ("miso_indiana_da", "2018-01-01", 50.0), ("miso_indiana_da", "2018-01-03", 56.0),
    ]
    basket = write_basket(tmp_path, TWO_COMP_BUILD, BLEND_OPS)
    conn = make_conn(tmp_path, rows)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    ops = result["indexes"]["ops"]
    assert ops["components"]["power"]["mode"] == "official+proxy"
    # hub_mean: 01-01 -> 50, 01-02 -> 52 (caiso only), 01-03 -> 55
    # trailing_mean(days=2): 01-01 -> 50, 01-02 -> 51, 01-03 -> 53.5
    # rebase (base month 2018-01, all 3 pts) anchor = 154.5/3 = 51.5
    # splice_anchored scale at 01-01 (100/97.0873...) = 1.03
    assert ops["index"]["2018-01-01"] == pytest.approx(100.0)  # official, unspliced
    assert ops["index"]["2018-01-02"] == pytest.approx(102.0)  # smoothed tail
    assert ops["index"]["2018-01-03"] == pytest.approx(107.0)
    assert ops["gate_flags"] == []


def test_blend_gate_triggers_on_any_blend_series_arrival(tmp_path):
    # only miso is tagged as arriving today; caiso is not. The gate's
    # arrived-today check must be ANY across the blend, not just the first
    # configured series, so the >5% jump still gets held one day.
    rows = BUILD_ROWS + [
        ("eia_elec_ind_us", "2017-01-01", 100.0), ("eia_elec_ind_us", "2018-01-01", 100.0),
        ("caiso_sp15_da", "2018-01-01", 50.0), ("caiso_sp15_da", "2018-01-05", 55.0),
        ("miso_indiana_da", "2018-01-01", 50.0), ("miso_indiana_da", "2018-01-05", 55.0),
    ]
    gate_ops = [
        {"code": "power", "label": "Power", "group": "power", "series": "eia_elec_ind_us",
         "weight": 1.0, "live_proxy_blend": ["caiso_sp15_da", "miso_indiana_da"],
         "live_proxy_smooth_days": 1},
    ]
    basket = write_basket(tmp_path, TWO_COMP_BUILD, gate_ops)
    conn = make_conn(tmp_path, rows,
                     vintages={("miso_indiana_da", "2018-01-05"): "2018-01-05"})
    result = dcindex.run(conn, today="2018-01-05", basket_path=basket)
    ops = result["indexes"]["ops"]
    assert ops["components"]["power"]["mode"] == "official+proxy"
    assert ops["index"]["2018-01-05"] == pytest.approx(100.0)  # held at prior value
    assert ops["gate_flags"] == ["power@2018-01-05"]


def test_dormant_blend_labels_official_and_changes_nothing(tmp_path):
    # all blend obs post-date the last official print with NO overlap at or
    # before it: splice_anchored has nothing to scale on -> official only.
    rows = BUILD_ROWS + [
        ("eia_elec_ind_us", "2017-01-01", 100.0), ("eia_elec_ind_us", "2018-01-01", 100.0),
        ("caiso_sp15_da", "2018-01-10", 50.0), ("caiso_sp15_da", "2018-01-11", 55.0),
        ("miso_indiana_da", "2018-01-10", 52.0), ("miso_indiana_da", "2018-01-12", 56.0),
    ]
    basket = write_basket(tmp_path, TWO_COMP_BUILD, BLEND_OPS)
    conn = make_conn(tmp_path, rows)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    ops = result["indexes"]["ops"]
    assert ops["components"]["power"]["mode"] == "official"
    assert ops["gate_flags"] == []
    assert max(ops["index"]) == "2018-01-01"  # no tail beyond the print


def test_component_with_no_grid_observations_raises_named_error(tmp_path):
    # every steel obs predates GRID_START: the daily grid only carries the
    # stale value forward, so there is no obs ON the grid to compute YoY at —
    # must raise a clear error naming the component, not a bare IndexError.
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2015-01-01", 100.0), ("ppi_steel", "2016-06-01", 105.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    with pytest.raises(ValueError, match="steel"):
        dcindex.run(conn, today="2018-01-15", basket_path=basket)


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


def test_parity_wage_from_older_quarter_treated_as_missing():
    # a state whose newest quarter is disclosure-suppressed keeps its prior
    # quarter in the store; dividing it by the newer national quarter would
    # bias build_mult low by a quarter of wage growth — degrade to null
    out = dcindex.parity_rows(
        power={"ca": ("2026-05-01", 12.0)}, wage={"ca": ("2025-10-01", 1900.0)},
        nat_power=("2026-05-01", 10.0), nat_wage=("2026-01-01", 1600.0),
        w_labor=0.30, w_power=0.55)
    row = out["states"][0]
    assert row["wage_rel"] is None and row["build_mult"] is None
    assert row["wage_asof"] is None
    assert row["ops_mult"] == pytest.approx(1.11)  # power side unaffected


def test_by_state_ignores_non_state_suffixes(tmp_path):
    conn = make_conn(tmp_path, [
        ("eia_elec_ind_us", "2026-05-01", 10.0),
        ("eia_elec_ind_ca", "2026-05-01", 12.0),
        # a future series family sharing the prefix must not become a "state"
        ("eia_elec_ind_res_tx", "2026-05-01", 9.0),
    ])
    assert set(dcindex._by_state(conn, "eia_elec_ind_")) == {"ca"}


def test_parity_unavailable_without_national_power():
    out = dcindex.parity_rows(power={"ca": ("2026-05-01", 12.0)}, wage={},
                              nat_power=None, nat_wage=None,
                              w_labor=0.30, w_power=0.55)
    assert out["mode"] == "unavailable" and out["states"] == []


GAP_HW = [{"code": "hw", "label": "HW", "group": "compute",
           "series": "ppi_storage", "weight": 1.0}]


def test_hardware_gap_yoy_at_own_last_obs(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
        ("ppi_storage", "2017-01-01", 100.0), ("ppi_storage", "2018-01-01", 120.0),
        ("ppi_servers", "2017-02-01", 200.0), ("ppi_servers", "2018-02-01", 202.0),
    ] + OPS_ROWS)
    basket = write_basket(
        tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS, hardware=GAP_HW,
        gap=[{"code": "storage", "label": "Storage PPI", "series": "ppi_storage"},
             {"code": "servers", "label": "Servers PPI", "series": "ppi_servers"}])
    result = dcindex.run(conn, today="2018-02-15", basket_path=basket)
    panel = {r["code"]: r for r in result["hardware_gap"]}
    assert [r["code"] for r in result["hardware_gap"]] == ["storage", "servers"]
    assert panel["storage"]["in_basket"] is True
    assert panel["storage"]["yoy_pct"] == pytest.approx(20.0)
    assert panel["storage"]["last_obs"] == "2018-01-01"
    # servers is NOT in the basket, and its YoY sits at ITS own last obs
    assert panel["servers"]["in_basket"] is False
    assert panel["servers"]["yoy_pct"] == pytest.approx(1.0)
    assert panel["servers"]["last_obs"] == "2018-02-01"


def test_hardware_gap_missing_base_is_none_and_empty_series_omitted(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
        ("ppi_storage", "2017-01-01", 100.0), ("ppi_storage", "2018-01-01", 120.0),
        # cpi_computers first obs 2017-09: its 2018-01 YoY base (2017-01) is missing
        ("cpi_computers", "2017-09-01", 50.0), ("cpi_computers", "2018-01-01", 51.0),
        # ppi_wafers has NO store rows at all
    ] + OPS_ROWS)
    basket = write_basket(
        tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS, hardware=GAP_HW,
        gap=[{"code": "storage", "label": "Storage PPI", "series": "ppi_storage"},
             {"code": "cpi_computers", "label": "CPI computers", "series": "cpi_computers"},
             {"code": "wafers", "label": "Wafers PPI", "series": "ppi_wafers"}])
    result = dcindex.run(conn, today="2018-02-15", basket_path=basket)
    panel = {r["code"]: r for r in result["hardware_gap"]}
    assert set(panel) == {"storage", "cpi_computers"}   # wafers row omitted
    assert panel["cpi_computers"]["yoy_pct"] is None    # base predates first obs


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


def test_construction_block_deflation_yoy_and_2014_avg():
    saar = {"2014-01-01": 1500.0, "2014-07-01": 2500.0,
            "2018-01-01": 20000.0, "2019-01-01": 30000.0}
    nsa = {"2018-01-01": 1600.0, "2019-01-01": 2000.0}
    build = {"2018-01-01": 100.0, "2019-01-01": 125.0}
    out = dcindex.construction_block(saar, nsa, build)
    assert out["months"] == ["2014-01-01", "2014-07-01", "2018-01-01", "2019-01-01"]
    assert out["saar"] == [1500.0, 2500.0, 20000.0, 30000.0]
    # deflator missing for 2014 months -> null; 30000/(125/100) = 24000
    assert out["real"] == [None, None, 20000.0, pytest.approx(24000.0)]
    assert out["yoy_pct"] == pytest.approx(25.0)      # NSA 2000 vs 1600
    assert out["yoy_asof"] == "2019-01-01"
    assert out["as_of"] == "2019-01-01"
    assert out["latest_saar"] == 30000.0
    assert out["unit"] == "$M"
    assert out["vs_2014_avg"] == pytest.approx(15.0)  # 30000 / mean(1500, 2500)


def test_construction_block_yoy_none_when_base_missing():
    out = dcindex.construction_block(
        {"2018-01-01": 100.0}, {"2018-01-01": 10.0}, {"2018-01-01": 100.0})
    assert out["yoy_pct"] is None
    assert out["vs_2014_avg"] is None                 # no 2014 obs


def test_construction_block_none_on_empty_inputs():
    assert dcindex.construction_block({}, {"2018-01-01": 1.0}, {}) is None
    assert dcindex.construction_block({"2018-01-01": 1.0}, {}, {}) is None


def test_construction_from_store(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
        ("census_dc_constr_saar", "2018-01-01", 20000.0),
        ("census_dc_constr_nsa", "2018-01-01", 1600.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    dc_result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    out = dcindex.construction_from_store(conn, dc_result)
    # both build components rebase to 100.0 at base month 2018-01 -> deflator 100
    assert out["months"] == ["2018-01-01"]
    assert out["real"] == [pytest.approx(20000.0)]


def test_construction_from_store_none_before_first_collect(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    dc_result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    assert dcindex.construction_from_store(conn, dc_result) is None
