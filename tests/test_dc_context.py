import json

import pytest

from pipeline import dc_context


def _peer(**over):
    p = {"key": "tnt_dcci", "firm": "Turner & Townsend", "short": "T&T DCCI",
         "publication": "Data Centre Construction Cost Index 2025-2026",
         "source": "T&T DCCI 2025-2026 (turnerandtownsend.com)",
         "asof": "2025-2026 edition", "scope": "dc", "basis": "cost_model",
         "period_basis": "calendar_year", "geography": "global", "derived": False,
         "caveat": "Data-centre specific, but global rather than US.",
         "quote": "5.5 percent increase in the cost per watt (2025)",
         "rows": [{"year": 2023, "escalation_pct": 8.0},
                  {"year": 2024, "escalation_pct": 5.5}]}
    p.update(over)
    return p


def _write(tmp_path, overrides=None):
    raw = {
        "colo": {"rate_kw_mo": 194.95, "yoy_pct": 6.5, "vacancy_pct": 1.4,
                 "under_construction_gw": 6.0, "asof": "H2 2025", "source": "CBRE"},
        "queue": {"generation_gw": 1400, "storage_gw": 890,
                  "asof": "2025", "source": "LBNL Queued Up 2025"},
        "peers": [_peer()],
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
    assert len(cfg.peers) == 1
    peer = cfg.peers[0]
    assert peer.key == "tnt_dcci" and peer.basis == "cost_model"
    assert peer.derived is False
    assert [r["year"] for r in peer.rows] == [2023, 2024]
    assert cfg.transformer is None


def test_multiple_peers_load_in_config_order(tmp_path):
    p = _write(tmp_path, {"peers": [
        _peer(),
        _peer(key="turner_tbci", short="Turner BCI", scope="nonres_building",
              basis="bid_price", period_basis="annual_average", geography="us"),
    ]})
    cfg = dc_context.load(p)
    assert [x.key for x in cfg.peers] == ["tnt_dcci", "turner_tbci"]


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
    assert len(cfg.peers) == 3
    for peer in cfg.peers:
        assert peer.quote and peer.source and peer.asof and peer.caveat


def test_real_config_peer_values_pinned():
    """Value-pin the seeded panel. Each figure below traces to a verbatim quote
    in docs/plans/2026-07-26-dc-peer-panel.md; a silent edit to config should
    fail here rather than ship an unevidenced number."""
    by_key = {p.key: p for p in dc_context.load().peers}
    assert set(by_key) == {"tnt_dcci", "turner_tbci", "bls_ppi_office"}
    latest = {k: p.rows[-1] for k, p in by_key.items()}
    assert latest["tnt_dcci"] == {"year": 2025, "escalation_pct": 5.5}
    assert latest["turner_tbci"] == {"year": 2025, "escalation_pct": 4.1}
    assert latest["bls_ppi_office"] == {"year": 2025, "escalation_pct": 3.09}
    # BLS PPI industry series measure the price contractors RECEIVE. An earlier
    # draft classified this as an input index and grouped it on our side of the
    # contract; that was wrong, and mislabelling it is the regression this pins.
    assert by_key["bls_ppi_office"].basis == "output_price"
    assert by_key["turner_tbci"].basis == "bid_price"
    assert by_key["tnt_dcci"].scope == "dc"
    # only the BLS rows are our own arithmetic off published levels
    assert [p.key for p in dc_context.load().peers if p.derived] == ["bls_ppi_office"]


@pytest.mark.parametrize("overrides,match", [
    ({"colo": {"rate_kw_mo": "expensive", "yoy_pct": 1, "vacancy_pct": 1,
               "under_construction_gw": 1, "asof": "x", "source": "y"}}, "numeric"),
    ({"colo": {"rate_kw_mo": 1, "yoy_pct": 1, "vacancy_pct": 1,
               "under_construction_gw": 1, "asof": "", "source": "y"}}, "non-empty"),
    ({"queue": {"generation_gw": 1400, "asof": "x", "source": "y"}}, "numeric"),
    ({"peers": []}, "non-empty"),
    ({"peers": [_peer(rows=[])]}, "non-empty"),
    ({"peers": [_peer(rows=[{"year": 2024, "escalation_pct": 5.5},
                            {"year": 2023, "escalation_pct": 8.0}])]}, "ascending"),
    ({"peers": [_peer(rows=[{"year": 2024, "escalation_pct": 5.5},
                            {"year": 2024, "escalation_pct": 8.0}])]}, "ascending"),
    ({"peers": [_peer(rows=[{"year": 2024, "escalation_pct": "high"}])]}, "numeric"),
    ({"peers": [_peer(quote="")]}, "non-empty"),
    ({"peers": [_peer(asof="")]}, "non-empty"),
    ({"peers": [_peer(basis="vibes")]}, "basis"),
    ({"peers": [_peer(scope="datacenter")]}, "scope"),
    ({"peers": [_peer(period_basis="q4_over_q4")]}, "period_basis"),
    ({"peers": [_peer(geography="emea")]}, "geography"),
    ({"peers": [_peer(derived="yes")]}, "bool"),
    ({"peers": [_peer(), _peer()]}, "unique"),
    ({"transformer": {"weeks": "long", "asof": "x", "source": "y"}}, "numeric"),
])
def test_garbled_config_rejected(tmp_path, overrides, match):
    with pytest.raises(ValueError, match=match):
        dc_context.load(_write(tmp_path, overrides))
