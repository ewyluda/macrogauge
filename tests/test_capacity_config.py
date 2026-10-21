import json
import re
from pathlib import Path

import pytest

from pipeline import capacity


def test_real_config_loads_and_orcl_is_hyperscaler():
    cfg = capacity.load_capacity()
    assert len(cfg["companies"]) == 29
    orcl = next(c for c in cfg["companies"] if c["t"] == "ORCL")
    assert orcl["role"] == "hyperscaler" and orcl["dupe"] is None
    assert all("px" not in c and "cap" not in c for c in cfg["companies"])


def _mini(tmp_path, **overrides):
    base = {"schema_version": 1, "as_of_curated": "2026-07-21", "note": "n",
            "basis": {}, "tenants": [], "geo": [], "geo_unmapped": [],
            "geo_note": "g",
            "companies": [{"t": "AAA", "n": "Aaa", "role": "neocloud",
                           "dupe": None, "private": False, "valuation_b": None,
                           "confidence": "filed", "op": 1, "con": 2, "plan": 3,
                           "nd": 0.5, "bk": None, "econ": {}, "sites": [],
                           "src": []}]}
    base.update(overrides)
    p = tmp_path / "capacity.json"
    p.write_text(json.dumps(base))
    return p


def test_duplicate_ticker_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"].append(dict(cfg["companies"][0]))
    p = tmp_path / "dup.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="duplicate"):
        capacity.load_capacity(p)


def test_bad_role_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["role"] = "benchmark"  # retired role
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="role"):
        capacity.load_capacity(p)


def test_negative_mw_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["op"] = -5
    p = tmp_path / "neg.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="op"):
        capacity.load_capacity(p)


def test_private_without_valuation_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["private"] = True
    p = tmp_path / "priv.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="valuation_b"):
        capacity.load_capacity(p)


# The hardening below exists because tenants/geo/geo_unmapped and several
# company fields pass through build() verbatim into schema-constrained
# artifact fields: a curation typo that only JSON Schema catches at write
# time aborts the ENTIRE daily run (run_daily re-raises ValidationError by
# design) instead of degrading the isolated capacity phase. The loader must
# reject it first — same principle test_dc_longlead.py pins for longlead.

def test_missing_schema_version_raises(tmp_path):
    p = _mini(tmp_path, schema_version=2)
    with pytest.raises(ValueError, match="schema_version"):
        capacity.load_capacity(p, market_keys=set())


def test_malformed_as_of_curated_raises(tmp_path):
    p = _mini(tmp_path, as_of_curated="July 21, 2026")
    with pytest.raises(ValueError, match="as_of_curated"):
        capacity.load_capacity(p, market_keys=set())


def test_non_numeric_nd_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["nd"] = "32.1"
    p = tmp_path / "nd.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="nd"):
        capacity.load_capacity(p, market_keys=set())


def test_short_sites_row_raises(tmp_path):
    # publish/capacity._events unpacks sites rows positionally — a 3-element
    # row must die here with the row in the message, not as an opaque
    # unpack error mid-publish.
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["sites"] = [["Helios", 800, "c"]]
    p = tmp_path / "sites.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="sites rows"):
        capacity.load_capacity(p, market_keys=set())


@pytest.mark.parametrize("eq", ["2027-Q4", "Q4 2027", 2027, "2027Q5"])
def test_bad_energize_q_raises(tmp_path, eq):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["sites"] = [["Helios", 800, "c", "2026", eq]]
    p = tmp_path / "eq.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="energize_q"):
        capacity.load_capacity(p, market_keys=set())


@pytest.mark.parametrize("eq", ["2027Q4", None])
def test_energize_q_row_loads(tmp_path, eq):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["sites"] = [["Helios", 800, "c", "2026", eq]]
    p = tmp_path / "eq.json"
    p.write_text(json.dumps(cfg))
    assert capacity.load_capacity(p, market_keys=set())["companies"][0]["sites"][0][4] == eq


def test_every_real_timeline_row_carries_curated_energize_q():
    # Every construction site with MW feeds the energization timeline; its
    # quarter is curated (energize_q, null = deliberately undated) rather than
    # left to the free-text fallback parse. A new row without one fails here,
    # at review time, not silently in the chart.
    missing = [(c["t"], s[0]) for c in capacity.load_capacity()["companies"]
               for s in c["sites"] if s[2] == "c" and s[1] and len(s) < 5]
    assert missing == []


def test_bad_site_status_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["sites"] = [["Helios", 800, "x", "2026"]]
    p = tmp_path / "st.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="o\\|c\\|p\\|s"):
        capacity.load_capacity(p, market_keys=set())


def test_short_tenants_row_raises(tmp_path):
    p = _mini(tmp_path, tenants=[["Someone", "AAA", 100]])
    with pytest.raises(ValueError, match="tenants rows"):
        capacity.load_capacity(p, market_keys=set())


def test_string_tenant_mw_raises(tmp_path):
    p = _mini(tmp_path, tenants=[["Someone", "AAA", "100", "terms"]])
    with pytest.raises(ValueError, match="mw"):
        capacity.load_capacity(p, market_keys=set())


def test_string_lat_raises(tmp_path):
    # The exact scenario from the review: "lat": "33.4" loads fine today,
    # builds fine, then dies in schema validation as the artifact is written.
    p = _mini(tmp_path, geo=[{"t": "AAA", "site": "S", "mw": 100, "st": "o",
                              "lat": "33.4", "lng": -112.0, "approx": False}])
    with pytest.raises(ValueError, match="lat"):
        capacity.load_capacity(p, market_keys=set())


def test_out_of_range_lng_raises(tmp_path):
    p = _mini(tmp_path, geo=[{"t": "AAA", "site": "S", "mw": 100, "st": "o",
                              "lat": 33.4, "lng": -212.0, "approx": False}])
    with pytest.raises(ValueError, match="lng"):
        capacity.load_capacity(p, market_keys=set())


def test_geo_unmapped_missing_why_raises(tmp_path):
    p = _mini(tmp_path, geo_unmapped=[{"t": "AAA", "site": "S", "mw": None,
                                       "st": "c"}])
    with pytest.raises(ValueError, match="why"):
        capacity.load_capacity(p, market_keys=set())


def test_unknown_tenant_or_geo_ticker_raises(tmp_path):
    p = _mini(tmp_path, tenants=[["Someone", "ZZZ", 100, "terms"]])
    with pytest.raises(ValueError, match="ZZZ"):
        capacity.load_capacity(p)


def test_registry_cross_check(tmp_path):
    # market_keys is stubbed out here: this test's fake registry_codes covers
    # only the fmp_cap_* cross-check, not the qcew_* codes dc_markets.load
    # would otherwise demand — and _mini()'s geo is empty, so no market
    # lookup is needed anyway.
    p = _mini(tmp_path)
    with pytest.raises(ValueError, match="fmp_cap"):
        capacity.load_capacity(p, registry_codes={"something_else"}, market_keys=set())
    capacity.load_capacity(p, registry_codes={"fmp_cap_aaa", "fmp_px_aaa"}, market_keys=set())


def test_real_config_passes_registry_cross_check():
    from pipeline import registry
    _, series = registry.load_registry()
    capacity.load_capacity(registry_codes={s.code for s in series})


def test_geo_entries_agree_with_their_same_name_site_row():
    # A site refreshed in `sites` but not in `geo`/`geo_unmapped` publishes two
    # MW figures for one project (PR 135: an 800 MW ramp beside a stale 400 MW
    # unmapped row). Where the names match, MW and status must too.
    cfg = capacity.load_capacity()
    sites = {(c["t"], s[0]): (s[1], s[2]) for c in cfg["companies"] for s in c["sites"]}
    bad = [(g["t"], g["site"]) for g in cfg["geo"] + cfg["geo_unmapped"]
           if (g["t"], g["site"]) in sites and sites[(g["t"], g["site"])] != (g["mw"], g["st"])]
    assert bad == []


def test_as_of_curated_is_not_older_than_the_capacity_evidence():
    # The maintenance workflow bumps as_of_curated on every filing refresh; the
    # page labels it "MW data as of". Evidence files are dated by retrieval.
    dated = [f.name[:10] for f in Path("docs/research/evidence").iterdir()
             if re.match(r"\d{4}-\d{2}-\d{2}-cap-", f.name)]
    assert capacity.load_capacity()["as_of_curated"] >= max(dated)


def test_geo_market_tags_reference_known_markets():
    from pipeline import capacity as capacity_cfg, dc_markets, registry
    _, series = registry.load_registry()
    cfg = capacity_cfg.load_capacity(registry_codes={s.code for s in series})
    keys = {m.key for m in dc_markets.load()}
    tagged = [g for g in cfg["geo"] if g.get("market")]
    assert tagged, "no geo entries tagged to a market"
    for g in tagged:
        assert g["market"] in keys, f"{g['site']}: unknown market {g['market']}"


def test_untagged_geo_entries_are_allowed():
    # ~80 of 112 sites sit outside the 20-market roster (plus 20 non-US
    # sites). Absence of a tag is the correct outcome, not an error.
    from pipeline import capacity as capacity_cfg, registry
    _, series = registry.load_registry()
    cfg = capacity_cfg.load_capacity(registry_codes={s.code for s in series})
    assert any("market" not in g for g in cfg["geo"])


@pytest.mark.parametrize("note", ["", 42])
def test_bad_ev_note_raises(tmp_path, note):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["ev_note"] = note
    p = tmp_path / "ev.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="ev_note"):
        capacity.load_capacity(p, market_keys=set())


def test_real_config_withholds_ev_per_mw_where_ai_mw_is_a_sliver():
    notes = {c["t"]: c.get("ev_note") for c in capacity.load_capacity()["companies"]}
    assert {t for t, n in notes.items() if n} == {"AKAM", "MARA", "EQIX"}


# Curation semantics the publisher cannot check for itself: _events puts a
# construction row's WHOLE MW in its energize_q, so a campus dated to its
# first, unquantified delivery overstates that quarter by everything that
# follows. A phased site is dated only when the phase's MW is stated (one row
# per phase); otherwise it takes the supported full-delivery quarter, or null.
_COMPLETION = re.compile(r"\b(full|fully|complete[sd]?|completion|last|rest|"
                         r"remainder|remaining|through(?:out)?)\b", re.I)


def test_dated_construction_rows_name_no_later_completion():
    from pipeline.publish.capacity import _milestones, site_quarter
    rows = {(c["t"], s[0]): s for c in capacity.load_capacity()["companies"]
            for s in c["sites"]}
    bad = []
    for key, s in rows.items():
        q = site_quarter(s)
        if s[2] != "c" or not s[1] or q is None:
            continue
        text = re.sub(r"\([^)]*\)", " ", s[3].lower())
        later = [m for clause in re.split(r"[;,]", text) if _COMPLETION.search(clause)
                 for m in _milestones(clause) if m > q]
        if later:
            bad.append(key)
    assert bad == []


@pytest.mark.parametrize("t,site,quarter", [
    # the reviewed cases: first delivery dated without a first-phase MW
    ("ORCL", "Doña Ana County NM (Project Jupiter, STACK)", None),
    ("ORCL", "Saline Township MI (Related Digital)", None),
    ("ORCL", "Port Washington WI (Vantage)", None),
    ("ORCL", "Shackelford County TX (Vantage)", "2028Q4"),
    ("NBIS", "Lappeenranta, Finland (AI factory)", None),
    ("CORZ", "AMD five-site program (Pecos TX · Auburn AL · Muskogee · Dalton · Hunt Co.)", "2028Q4"),
    ("WULF", "Justified Data — Hawesville KY (Anthropic)", "2028Q1"),
    ("STARGATE", "Milam County TX (SB Energy / SoftBank)", "2028Q4"),
    # an explicit full-capacity quarter survives an unquantified earlier ramp
    ("BTDR", "Malaysia (3rd hub) — A901 (AI cloud)", "2027Q2"),
])
def test_phased_sites_without_phase_mw_are_not_dated_to_first_delivery(t, site, quarter):
    co = next(c for c in capacity.load_capacity()["companies"] if c["t"] == t)
    assert next(s for s in co["sites"] if s[0] == site)[4] == quarter


@pytest.mark.parametrize("t,prefix,phases", [
    ("DLR", "Northern Virginia — ", [(96, "2028Q2"), (192, "2027Q2")]),
    ("RIOT", "Rockdale (frontier AI lab) — ", [(95, "2028Q2"), (96, "2027Q4")]),
])
def test_stated_phases_carry_their_own_quarters(t, prefix, phases):
    co = next(c for c in capacity.load_capacity()["companies"] if c["t"] == t)
    assert sorted((s[1], s[4]) for s in co["sites"] if s[0].startswith(prefix)) == phases


# `mw` is critical IT on every surface (page, map sizing, tables). A figure
# the row's own text labels grid / gross / utility power must not fill it:
# keep it in the text and leave mw null (no unsourced PUE conversion).
_GRID_FIGURE = re.compile(r"\d[\d,.]*\s*(?:MW|GW)\)?\s*\(?(?:grid|gross|utility)\b|"
                          r"\b(?:grid|gross|utility)\s+(?:MW|GW)\b|(?<!\w)not (?:critical[- ])?IT\b", re.I)
_IT_FIGURE = re.compile(r"\d[\d,.]*\s*MW\s+(?:critical[- ])?IT\b|\bIT MW\b|"
                        r"(?<!not )critical[- ]IT\b(?!\s*MW n/d)", re.I)


def test_grid_only_figures_never_fill_the_critical_it_field():
    cfg = capacity.load_capacity()
    entries = [((c["t"], s[0]), s[1], f"{s[0]} {s[3]}") for c in cfg["companies"] for s in c["sites"]]
    entries += [((g["t"], g["site"]), g["mw"], " ".join(str(g.get(k) or "") for k in ("site", "when", "why")))
                for g in cfg["geo"] + cfg["geo_unmapped"]]
    bad = [k for k, mw, text in entries
           if mw is not None and _GRID_FIGURE.search(text) and not _IT_FIGURE.search(text)]
    assert bad == []


@pytest.mark.parametrize("text", ["1.6 GW grid (FY26 10-K)", "800 MW (grid); TCA signed",
                                  "570 MW grid power (not IT)", "500 MW gross; Batch Zero",
                                  "750 MW utility load study"])
def test_grid_figure_pattern_reads_grid_labels(text):
    assert _GRID_FIGURE.search(text) and not _IT_FIGURE.search(text)


@pytest.mark.parametrize("text", ["300 MW gross (≈200 MW IT at the stated ratio)",
                                  "5 MW gross / 3 MW IT", "grid power via We Energies; ~1 GW per Oracle"])
def test_grid_figure_pattern_spares_stated_it_and_power_sources(text):
    assert not (_GRID_FIGURE.search(text) and not _IT_FIGURE.search(text))
