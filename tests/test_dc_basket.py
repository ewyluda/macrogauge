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
    # wave-4 option B: the wholesale tail was DEFERRED from the index after a
    # live run showed the anchored level-splice maps the ~2.8x seasonal
    # wholesale swing onto the seasonally-flat retail series (ops YoY +52%).
    # Wave 4b then built the year-ratio coupling and BACKTESTED it against 8
    # realized prints: every lambda>0 lost to carry-forward (spec §10), so
    # the index stays official-only and all tail machinery is config-gated.
    power = next(c for c in baskets["ops"] if c.code == "power")
    assert power.live_proxy is None
    assert power.live_proxy_blend is None
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


def test_live_proxy_and_blend_mutually_exclusive_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy": "s_b", "live_proxy_blend": ["s_c"]}],
               OK_OPS)
    with pytest.raises(ValueError, match="mutually exclusive"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_c", "s_p", "s_h"})


def test_smooth_days_without_blend_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_smooth_days": 7}],
               OK_OPS)
    with pytest.raises(ValueError, match="live_proxy_smooth_days"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_p", "s_h"})


def test_empty_blend_list_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": []}],
               OK_OPS)
    with pytest.raises(ValueError, match="non-empty"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_p", "s_h"})


def test_unknown_blend_code_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b", "nope"]}],
               OK_OPS)
    with pytest.raises(ValueError, match="unknown series code"):
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


def test_year_ratio_requires_blend_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="year_ratio"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_p", "s_h"})


def test_year_ratio_requires_smooth_days_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="live_proxy_smooth_days"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_year_ratio_requires_passthrough_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "year_ratio"}],
               OK_OPS)
    with pytest.raises(ValueError, match="live_proxy_passthrough"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_passthrough_without_year_ratio_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="live_proxy_passthrough"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


@pytest.mark.parametrize("lam", [0.0, -0.5, 1.5])
def test_passthrough_out_of_range_rejected(tmp_path, lam):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": lam}],
               OK_OPS)
    with pytest.raises(ValueError, match="passthrough"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_unknown_transform_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "sorcery"}],
               OK_OPS)
    with pytest.raises(ValueError, match="transform"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_duplicate_blend_codes_rejected(tmp_path):
    # wave-4 final-review entry task: dup hubs would double-weight in hub_mean
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b", "s_b"]}],
               OK_OPS)
    with pytest.raises(ValueError, match="duplicate"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_year_ratio_valid_config_loads(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b", "s_c"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    _, baskets = dc_basket.load_baskets(
        p, registry_codes={"s_a", "s_b", "s_c", "s_p", "s_h"})
    comp = baskets["build"][0]
    assert comp.live_proxy_transform == "year_ratio"
    assert comp.live_proxy_passthrough == 0.5


def test_default_transform_is_level(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0}],
               OK_OPS)
    _, baskets = dc_basket.load_baskets(p, registry_codes={"s_a", "s_p", "s_h"})
    assert baskets["build"][0].live_proxy_transform == "level"
    assert baskets["build"][0].live_proxy_passthrough is None
