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
