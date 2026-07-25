import json
import sqlite3
from pathlib import Path

import jsonschema

from pipeline.dc_markets import MarketSpec
from pipeline.publish import dc_markets as writer

SCHEMA = json.loads(
    (Path(__file__).parent.parent / "schemas" / "dc_markets.schema.json").read_text())

MARKETS = (
    MarketSpec(key="nova", name="Northern Virginia", counties=("51107",),
               state="VA", iso="PJM", grid=None,
               utility="Dominion Energy Virginia", note=""),
    MarketSpec(key="hillsboro", name="Hillsboro OR", counties=("41067",),
               state="OR", iso=None, grid="WECC",
               utility="Portland General Electric", note=""),
)
META = {"as_of_curated": "2026-07-25", "note": "tight core counties"}
CAP_CFG = {"geo": [
    {"t": "DLR", "site": "Ashburn", "mw": None, "st": "o", "lat": 39.0,
     "lng": -77.5, "approx": True, "when": "operating", "market": "nova"},
    {"t": "AMZN", "site": "Somewhere", "mw": 500, "st": "c", "lat": 39.1,
     "lng": -77.6, "approx": True, "when": "2027", "market": "nova"},
    {"t": "META", "site": "Elsewhere", "mw": 900, "st": "c", "lat": 33.0,
     "lng": -84.0, "approx": True, "when": "2027"},
]}


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, "
                 "value REAL, vintage_date TEXT)")
    rows = [
        ("qcew_wage23_us", "2024-10-01", 1727.0), ("qcew_wage23_us", "2025-10-01", 1815.0),
        ("qcew_emp23_us", "2024-10-01", 8117805.0), ("qcew_emp23_us", "2025-10-01", 8195199.0),
        ("qcew_wage23_c51107", "2024-10-01", 2001.0),
        ("qcew_wage23_c51107", "2025-10-01", 2264.0),
        ("qcew_emp23_c51107", "2024-10-01", 22372.0),
        ("qcew_emp23_c51107", "2025-10-01", 26151.0),
        # 41067 (Hillsboro) intentionally absent — disclosure-suppressed
    ]
    conn.executemany(
        "INSERT INTO observations VALUES (?,?,?,'2026-07-25')", rows)
    return conn


def test_payload_validates_against_schema():
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    jsonschema.validate({"published_at": "2026-07-25T00:00:00Z", **payload},
                        SCHEMA)


def test_suppressed_market_still_validates_and_is_marked_unavailable():
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    jsonschema.validate({"published_at": "2026-07-25T00:00:00Z", **payload},
                        SCHEMA)
    by = {m["key"]: m for m in payload["markets"]}
    assert by["hillsboro"]["available"] is False
    assert by["hillsboro"]["wage"] is None


def test_empty_store_degrades_to_valid_payload():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, "
                 "value REAL, vintage_date TEXT)")
    payload = writer.build(conn, MARKETS, CAP_CFG, META)
    jsonschema.validate({"published_at": "2026-07-25T00:00:00Z", **payload},
                        SCHEMA)
    assert payload["as_of"] is None
    assert all(m["available"] is False for m in payload["markets"])


def test_capacity_join_publishes_four_numbers_not_one():
    # A bare MW total would read as authoritative. Sites, disclosed MW, and
    # undisclosed-MW site count all publish so the denominator is visible.
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    nova = {m["key"]: m for m in payload["markets"]}["nova"]
    assert nova["sites"] == 2
    assert nova["mw_disclosed"] == 500
    assert nova["sites_mw_undisclosed"] == 1


def test_untagged_geo_entries_are_not_joined_to_any_market():
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    assert sum(m["sites"] for m in payload["markets"]) == 2  # the META site is untagged


def test_write_lands_the_file(tmp_path):
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    path = writer.write(payload, tmp_path, published_at="2026-07-25T00:00:00Z")
    assert path.name == "dc_markets.json"
    on_disk = json.loads(path.read_text())
    assert on_disk["published_at"] == "2026-07-25T00:00:00Z"
    jsonschema.validate(on_disk, SCHEMA)


def test_new_fields_populate_for_a_like_for_like_market():
    # nova has both quarters for its one county, so it clears the
    # like-for-like bar: wage_cur/emp_cur_total reconcile with wage/emp
    # exactly (same set), and yoy_basis says so explicitly.
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    nova = {m["key"]: m for m in payload["markets"]}["nova"]
    assert nova["yoy_basis"] == "like_for_like"
    assert nova["wage_cur"] == nova["wage"] == 2264.0
    assert nova["emp_cur_total"] == nova["emp"] == 26151


def test_emp_cur_total_present_even_when_like_for_like_set_is_empty():
    # Hillsboro's only county never appears in the store at all (disclosure
    # suppressed), so BOTH the like-for-like set and the current-quarter-only
    # set are empty. wage_cur/emp_cur_total must still be present KEYS on the
    # row -- null, not missing -- so a consumer never has to special-case a
    # KeyError for the fully-suppressed regime.
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    hillsboro = {m["key"]: m for m in payload["markets"]}["hillsboro"]
    assert "wage_cur" in hillsboro and hillsboro["wage_cur"] is None
    assert "emp_cur_total" in hillsboro and hillsboro["emp_cur_total"] is None
    assert hillsboro["yoy_basis"] is None


def test_fallback_regime_validates_and_leaves_yoy_basis_null():
    # nova's only county has ONLY a current-quarter row -- no base-quarter
    # row at all (e.g. its first year in QCEW). No county clears the
    # like-for-like bar, so the market falls back to the current-quarter-only
    # set: a level still resolves (available True, wage_cur/emp_cur_total
    # populated) but yoy_basis is None -- there is no ratio in this regime,
    # ever, and wage_yoy_pct being None here must not be mistaken for "no
    # data" (there IS a level).
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, "
                 "value REAL, vintage_date TEXT)")
    rows = [
        ("qcew_wage23_us", "2024-10-01", 1727.0), ("qcew_wage23_us", "2025-10-01", 1815.0),
        ("qcew_emp23_us", "2024-10-01", 8117805.0), ("qcew_emp23_us", "2025-10-01", 8195199.0),
        # 51107 has ONLY the current quarter -- no 2024-10-01 row at all
        ("qcew_wage23_c51107", "2025-10-01", 2264.0),
        ("qcew_emp23_c51107", "2025-10-01", 26151.0),
    ]
    conn.executemany(
        "INSERT INTO observations VALUES (?,?,?,'2026-07-25')", rows)
    payload = writer.build(conn, (MARKETS[0],), CAP_CFG, META)
    jsonschema.validate({"published_at": "2026-07-25T00:00:00Z", **payload}, SCHEMA)
    nova = payload["markets"][0]
    assert nova["available"] is True
    assert nova["yoy_basis"] is None
    assert nova["wage_yoy_pct"] is None
    assert nova["wage"] == nova["wage_cur"] == 2264.0
    assert nova["emp"] == nova["emp_cur_total"] == 26151
