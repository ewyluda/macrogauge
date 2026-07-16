import json

import pytest

from pipeline import dc_basket


def test_load_real_baskets():
    base_month, baskets = dc_basket.load_baskets()
    assert base_month == "2018-01"
    assert set(baskets) == {"build", "ops", "hardware"}
    for name, comps in baskets.items():
        assert abs(sum(c.weight for c in comps) - 1.0) <= 1e-9
    proxied = {c.code: c.live_proxy for c in baskets["build"] if c.live_proxy}
    assert proxied == {"copper_wire": "fmp_copper", "alum_shapes": "fmp_alum"}
    # hardware v1 carried no proxies; wave 3a ships the dormant DRAM tail
    hw_proxied = {c.code: c.live_proxy for c in baskets["hardware"] if c.live_proxy}
    assert hw_proxied == {"storage": "dramex_nand_mlc64"}
    labels = dc_basket.load_group_labels()
    assert {c.group for c in baskets["hardware"]} <= set(labels)
    w_labor, w_power = dc_basket.parity_shares(baskets)
    assert 0 < w_labor < 1 and 0 < w_power < 1
    assert labels["labor"]


def test_load_real_hardware_gap():
    rows = dc_basket.load_hardware_gap()
    assert len(rows) == 11
    _, baskets = dc_basket.load_baskets()
    hw_series = {c.series for c in baskets["hardware"]}
    assert {r.series for r in rows if r.in_basket} == hw_series
    assert sum(r.in_basket for r in rows) == 5
    codes = [r.code for r in rows]
    assert len(codes) == len(set(codes))


OK_HW = [{"code": "hw", "label": "H", "group": "compute", "series": "s_h", "weight": 1.0}]


def _write(tmp_path, build, ops, hardware=None, gap=None):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops,
                             "hardware": hardware or OK_HW,
                             "hardware_gap": gap or []}))
    return p


OK_OPS = [{"code": "power", "label": "P", "group": "power", "series": "s_p", "weight": 1.0}]


def test_bad_weight_sum_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 0.6}],
               OK_OPS)
    with pytest.raises(ValueError, match="weights sum"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_p", "s_h"})


def test_unknown_series_code_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "nope", "weight": 1.0}],
               OK_OPS)
    with pytest.raises(ValueError, match="unknown series code"):
        dc_basket.load_baskets(p, registry_codes={"s_p", "s_h"})


def test_duplicate_component_code_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 0.5},
                {"code": "a", "label": "A2", "group": "labor", "series": "s_b", "weight": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="duplicate"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_hardware_gap_unknown_series_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 1.0}],
               OK_OPS,
               gap=[{"code": "g", "label": "G", "series": "nope"}])
    with pytest.raises(ValueError, match="unknown series code"):
        dc_basket.load_hardware_gap(p, registry_codes={"s_a", "s_p", "s_h"})


def test_hardware_gap_duplicate_codes_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 1.0}],
               OK_OPS,
               gap=[{"code": "g", "label": "G", "series": "s_a"},
                    {"code": "g", "label": "G2", "series": "s_p"}])
    with pytest.raises(ValueError, match="duplicate"):
        dc_basket.load_hardware_gap(p, registry_codes={"s_a", "s_p", "s_h"})
