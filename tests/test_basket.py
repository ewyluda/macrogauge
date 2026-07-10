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
    assert by_code["shelter_owned"].live_variants == ("gauge", "col", "pce")
    assert by_code["fuel"].live_variants == ("gauge", "tracker", "col", "pce")
    assert by_code["medical"].live_blend is None
    assert by_code["medical"].live_variants == ()
    assert by_code["food_home"].live_blend is None
    assert by_code["food_home"].live_variants == ()


def test_official_series_exist_in_registry():
    _, comps = basket.load_basket()
    _, series = registry.load_registry()
    codes = {s.code for s in series}
    missing = [c.official_series for c in comps if c.official_series not in codes]
    assert missing == []


def test_bad_weight_sum_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 0.5, "pce_weight": 0.5, "official_series": "X"},
        {"code": "b", "label": "B", "weight": 0.4, "pce_weight": 0.5, "official_series": "Y"}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="sum"):
        basket.load_basket(p)


def test_duplicate_code_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 0.5, "pce_weight": 0.5, "official_series": "X"},
        {"code": "a", "label": "A2", "weight": 0.5, "pce_weight": 0.5, "official_series": "Y"}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="duplicate"):
        basket.load_basket(p)


def test_live_variants_without_blend_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 1.0, "pce_weight": 1.0, "official_series": "X",
         "live_variants": ["gauge"]}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="live_blend"):
        basket.load_basket(p)


def _minimal_basket_config():
    return {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 1.0, "pce_weight": 1.0, "official_series": "X"}]}


def test_lead_days_parsed_and_validated(tmp_path):
    cfg = _minimal_basket_config()
    cfg["components"][0]["live_blend"] = {"src_a": 1.0}
    cfg["components"][0]["live_variants"] = ["gauge"]
    cfg["components"][0]["lead_days"] = {"src_a": 30}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(cfg))
    _, comps = basket.load_basket(p)
    assert comps[0].lead_days == {"src_a": 30}


def test_lead_days_key_must_be_in_live_blend(tmp_path):
    cfg = _minimal_basket_config()
    cfg["components"][0]["live_blend"] = {"src_a": 1.0}
    cfg["components"][0]["live_variants"] = ["gauge"]
    cfg["components"][0]["lead_days"] = {"other_src": 30}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(cfg))
    try:
        basket.load_basket(p)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "lead_days" in str(e)


def test_pce_weights_parsed_and_sum_to_one():
    _, comps = basket.load_basket()
    assert abs(sum(c.pce_weight for c in comps) - 1.0) <= 1e-9


def test_supercore_components_exist_in_basket():
    _, comps = basket.load_basket()
    codes = {c.code for c in comps}
    supercore = basket.load_supercore_components()
    assert supercore and set(supercore) <= codes


def test_pce_weights_must_sum_to_one(tmp_path):
    # corrupt one pce_weight in a copy of the real config; expect ValueError
    import json
    from pipeline.basket import DEFAULT_PATH
    cfg = json.loads(DEFAULT_PATH.read_text())
    cfg["components"][0]["pce_weight"] += 0.1
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(cfg))
    try:
        basket.load_basket(p)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "pce" in str(e).lower()
