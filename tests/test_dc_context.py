import json

import pytest

from pipeline import dc_context


def _write(tmp_path, overrides=None):
    raw = {
        "colo": {"rate_kw_mo": 194.95, "yoy_pct": 6.5, "vacancy_pct": 1.4,
                 "under_construction_gw": 6.0, "asof": "H2 2025", "source": "CBRE"},
        "queue": {"generation_gw": 1400, "storage_gw": 890,
                  "asof": "2025", "source": "LBNL Queued Up 2025"},
        "tnt": {"rows": [{"year": 2023, "escalation_pct": 8.0},
                          {"year": 2024, "escalation_pct": 5.5}],
                "asof": "2025", "source": "Turner & Townsend DCCI"},
        "transformer": None,
    }
    raw.update(overrides or {})
    p = tmp_path / "dc_context.json"
    p.write_text(json.dumps(raw))
    return p


def test_load_happy_path(tmp_path):
    cfg = dc_context.load(_write(tmp_path))
    assert cfg.colo.fields["rate_kw_mo"] == 194.95
    assert cfg.colo.asof == "H2 2025" and cfg.colo.source == "CBRE"
    assert cfg.queue.fields == {"generation_gw": 1400, "storage_gw": 890}
    assert [r["year"] for r in cfg.tnt_rows] == [2023, 2024]
    assert cfg.transformer is None


def test_transformer_present_loads(tmp_path):
    p = _write(tmp_path, {"transformer": {"weeks": 128, "asof": "2025-11",
                                          "source": "Wood Mackenzie"}})
    cfg = dc_context.load(p)
    assert cfg.transformer.fields == {"weeks": 128}


def test_load_real_config():
    cfg = dc_context.load()
    # every card carries provenance; values are spike-verified, not asserted here
    for card in (cfg.colo, cfg.queue):
        assert card.asof and card.source
    assert cfg.tnt_rows and cfg.tnt_asof and cfg.tnt_source


@pytest.mark.parametrize("overrides,match", [
    ({"colo": {"rate_kw_mo": "expensive", "yoy_pct": 1, "vacancy_pct": 1,
               "under_construction_gw": 1, "asof": "x", "source": "y"}}, "numeric"),
    ({"colo": {"rate_kw_mo": 1, "yoy_pct": 1, "vacancy_pct": 1,
               "under_construction_gw": 1, "asof": "", "source": "y"}}, "non-empty"),
    ({"queue": {"generation_gw": 1400, "asof": "x", "source": "y"}}, "numeric"),
    ({"tnt": {"rows": [], "asof": "x", "source": "y"}}, "non-empty"),
    ({"tnt": {"rows": [{"year": 2024, "escalation_pct": 5.5},
               {"year": 2023, "escalation_pct": 8.0}],
      "asof": "x", "source": "y"}}, "ascending"),
    ({"tnt": {"rows": [{"year": 2024, "escalation_pct": "high"}],
      "asof": "x", "source": "y"}}, "numeric"),
    ({"tnt": {"rows": [{"year": 2024, "escalation_pct": 5.5}],
      "asof": "", "source": "y"}}, "asof"),
    ({"transformer": {"weeks": "long", "asof": "x", "source": "y"}}, "numeric"),
])
def test_garbled_config_rejected(tmp_path, overrides, match):
    with pytest.raises(ValueError, match=match):
        dc_context.load(_write(tmp_path, overrides))
