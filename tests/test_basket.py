import json

import pytest

from pipeline import basket, registry


def test_default_basket_loads_and_is_valid():
    base_month, comps = basket.load_basket()
    assert base_month == "2018-01"
    assert len(comps) == 14
    assert sum(c.weight for c in comps) == pytest.approx(1.0, abs=1e-9)
    by_code = {c.code: c for c in comps}
    assert by_code["shelter_owned"].weight == 0.265
    assert by_code["shelter_owned"].official_series == "CUUR0000SEHC"
    assert by_code["shelter_owned"].live_variants == ("gauge",)
    assert by_code["fuel"].live_variants == ("gauge", "tracker")
    assert by_code["medical"].live_blend is None
    assert by_code["medical"].live_variants == ()


def test_official_series_exist_in_registry():
    _, comps = basket.load_basket()
    _, series = registry.load_registry()
    codes = {s.code for s in series}
    missing = [c.official_series for c in comps if c.official_series not in codes]
    assert missing == []


def test_bad_weight_sum_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 0.5, "official_series": "X"},
        {"code": "b", "label": "B", "weight": 0.4, "official_series": "Y"}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="sum"):
        basket.load_basket(p)


def test_duplicate_code_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 0.5, "official_series": "X"},
        {"code": "a", "label": "A2", "weight": 0.5, "official_series": "Y"}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="duplicate"):
        basket.load_basket(p)


def test_live_variants_without_blend_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 1.0, "official_series": "X",
         "live_variants": ["gauge"]}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="live_blend"):
        basket.load_basket(p)
