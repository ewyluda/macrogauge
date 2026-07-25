import json

import pytest

from pipeline import dc_markets

# The roster pin. config-driving the market list is a deliberate departure
# from metros.py/geo.py, which hardcode METROS/STATES "pinned by tests" — so
# the pin lives here instead of in a writer test.
EXPECTED_KEYS = (
    "nova", "dfw", "chicago", "phoenix", "atlanta", "svl", "columbus", "slc",
    "abilene", "newcarlisle", "mtpleasant", "richland", "memphis",
    "councilbluffs", "desmoines", "cheyenne", "reno", "quincy", "sanantonio",
    "hillsboro")


def _codes(markets):
    out = set()
    for m in markets:
        for f in m.counties:
            out |= {f"qcew_wage23_c{f}", f"qcew_emp23_c{f}"}
    return out


def test_roster_is_pinned():
    markets = dc_markets.load()
    assert tuple(m.key for m in markets) == EXPECTED_KEYS
    assert len({f for m in markets for f in m.counties}) == 30


def test_every_county_has_both_registered_series():
    markets = dc_markets.load()
    from pipeline import registry
    _, series = registry.load_registry()
    codes = {s.code for s in series}
    for m in markets:
        for f in m.counties:
            assert f"qcew_wage23_c{f}" in codes, f"{m.key}: {f} wage unregistered"
            assert f"qcew_emp23_c{f}" in codes, f"{m.key}: {f} emp unregistered"


def test_unknown_series_code_raises(tmp_path):
    raw = {"as_of_curated": "2026-07-25", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["99999"], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}]}
    p = tmp_path / "m.json"
    p.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="unknown series code"):
        dc_markets.load(p, registry_codes=set())


def test_duplicate_keys_raise(tmp_path):
    m = {"key": "k", "name": "K", "counties": ["51107"], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x",
                             "markets": [m, dict(m)]}))
    with pytest.raises(ValueError, match="duplicate market key"):
        dc_markets.load(p, registry_codes={"qcew_wage23_c51107",
                                           "qcew_emp23_c51107"})


def test_malformed_fips_raises(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["511"], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="5-digit county FIPS"):
        dc_markets.load(p, registry_codes=set())


def test_duplicate_county_within_market_raises(tmp_path):
    # A duplicate FIPS inside one market's counties list must be rejected
    # even when the rest of the set is complete and correct — appending a
    # redundant duplicate alongside otherwise-valid counties doesn't change
    # the distinct-county count, so test_roster_is_pinned's `len({...}) ==
    # 30` check would not catch this. Left unchecked it would silently
    # double-weight the county in downstream employment-weighted
    # aggregation, which iterates MarketSpec.counties.
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["51107", "51153", "51107"],
         "state": "VA", "iso": "PJM", "grid": None, "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="duplicate county"):
        dc_markets.load(p, registry_codes={
            "qcew_wage23_c51107", "qcew_emp23_c51107",
            "qcew_wage23_c51153", "qcew_emp23_c51153"})


def test_empty_counties_raise(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": [], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="non-empty counties"):
        dc_markets.load(p, registry_codes=set())


def test_exactly_one_of_iso_or_grid(tmp_path):
    # A market is either in an organized market (iso) or it isn't (grid names
    # the region). Setting both, or neither, is a curation error — and it
    # matters because the PJM capacity ladder renders off `iso`.
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["51107"], "state": "VA",
         "iso": "PJM", "grid": "WECC", "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="exactly one of iso/grid"):
        dc_markets.load(p, registry_codes={"qcew_wage23_c51107",
                                           "qcew_emp23_c51107"})


def test_unknown_iso_raises(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["51107"], "state": "VA",
         "iso": "PJMM", "grid": None, "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="unknown iso"):
        dc_markets.load(p, registry_codes={"qcew_wage23_c51107",
                                           "qcew_emp23_c51107"})
