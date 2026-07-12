import json

import pytest

from pipeline import dc_basket


def test_load_real_baskets():
    base_month, baskets = dc_basket.load_baskets()
    assert base_month == "2018-01"
    assert set(baskets) == {"build", "ops"}
    for name, comps in baskets.items():
        assert abs(sum(c.weight for c in comps) - 1.0) <= 1e-9
    proxied = {c.code: c.live_proxy for c in baskets["build"] if c.live_proxy}
    assert proxied == {"copper_wire": "fmp_copper", "alum_shapes": "fmp_alum"}
    w_labor, w_power = dc_basket.parity_shares(baskets)
    assert 0 < w_labor < 1 and 0 < w_power < 1
    assert dc_basket.load_group_labels()["labor"]


def _write(tmp_path, build, ops):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops}))
    return p


OK_OPS = [{"code": "power", "label": "P", "group": "power", "series": "s_p", "weight": 1.0}]


def test_bad_weight_sum_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 0.6}],
               OK_OPS)
    with pytest.raises(ValueError, match="weights sum"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_p"})


def test_unknown_series_code_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "nope", "weight": 1.0}],
               OK_OPS)
    with pytest.raises(ValueError, match="unknown series code"):
        dc_basket.load_baskets(p, registry_codes={"s_p"})


def test_duplicate_component_code_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 0.5},
                {"code": "a", "label": "A2", "group": "labor", "series": "s_b", "weight": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="duplicate"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p"})
