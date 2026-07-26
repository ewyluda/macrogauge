"""The grading engine is a pure function of dicts -- no store, no I/O."""
import sqlite3
from collections import namedtuple

import pytest

from pipeline.engine import dcgrade

W = {"a": 0.6, "b": 0.4}

# Mock component class for testing
Component = namedtuple("Component", ["code", "series"])


def test_load_component_versions_reads_by_series_and_keys_by_code():
    """load_component_versions must read from comp.series (store code) but
    key its output by comp.code (component id). Swapping them is the standing
    trap this test guards against."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")

    # Insert test data DELIBERATELY OUT OF VINTAGE ORDER to verify the
    # ORDER BY vintage_date clause does the work (not just SQLite rowid ordering).
    # Newest vintage first, then older -- this forces the sort.
    rows = [
        ("ppi_steel", "2015-03-01", 101.0, "2015-04-14", "fred", "api"),  # newer vintage first
        ("ppi_steel", "2015-03-01", 100.0, "2015-03-13", "fred", "api"),  # older vintage second
        ("ppi_steel", "2015-04-01", 102.0, "2015-04-14", "fred", "api"),
    ]
    conn.executemany(
        "INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)", rows)
    conn.commit()

    # Create a component with different .code and .series
    comp = Component(code="steel", series="ppi_steel")
    components = [comp]

    result = dcgrade.load_component_versions(conn, components)

    # Output must be keyed by comp.code ("steel"), not comp.series ("ppi_steel")
    assert "steel" in result
    assert "ppi_steel" not in result

    # Verify rows from the store series code were found
    assert "2015-03-01" in result["steel"]
    assert "2015-04-01" in result["steel"]

    # Verify the ordering guarantee: vintages must be ascending by vintage_date
    # even though we inserted them in REVERSE order. Downstream code takes
    # known[-1] to get the latest vintage at or before a cutoff, so this must
    # hold: if this assertion passes but ORDER BY vintage_date is removed from
    # load_component_versions, the test fails (verified below).
    versions_mar = result["steel"]["2015-03-01"]
    assert versions_mar == [("2015-03-13", 100.0), ("2015-04-14", 101.0)]

    versions_apr = result["steel"]["2015-04-01"]
    assert versions_apr == [("2015-04-14", 102.0)]

    conn.close()


def test_load_component_versions_detects_swapped_series_and_code():
    """Verify that if code/series were swapped in the implementation,
    the test would catch it."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")

    # Insert data under "ppi_steel" (the store series code)
    conn.execute(
        "INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)",
        ("ppi_steel", "2015-03-01", 100.0, "2015-03-13", "fred", "api"))
    conn.commit()

    # Component with code="steel" and series="ppi_steel"
    comp = Component(code="steel", series="ppi_steel")
    result = dcgrade.load_component_versions(conn, [comp])

    # If the implementation mistakenly used comp.code to query,
    # it would find nothing (no rows with series_code="steel")
    # This confirms we're checking the right thing
    assert result["steel"] == {"2015-03-01": [("2015-03-13", 100.0)]}

    conn.close()


def _versions():
    """Two components. 'a' revises its 2008-02 value in a later vintage."""
    return {
        "a": {"2008-01-01": [("2015-03-13", 100.0)],
              "2008-02-01": [("2015-03-13", 102.0), ("2015-04-14", 104.0)]},
        "b": {"2008-01-01": [("2015-03-13", 200.0)],
              "2008-02-01": [("2015-03-13", 210.0)]},
    }


def test_index_asof_uses_only_vintages_at_or_before_the_cutoff():
    idx = dcgrade.index_asof(_versions(), "2015-03-13", W, base_month="2008-01-01")
    # a: 102/100*100 = 102 ; b: 210/200*100 = 105
    assert idx["2008-02-01"] == pytest.approx(0.6 * 102.0 + 0.4 * 105.0)


def test_index_asof_picks_up_the_revision_at_a_later_cutoff():
    idx = dcgrade.index_asof(_versions(), "2015-04-14", W, base_month="2008-01-01")
    # a's 2008-02 is now 104 -> 104
    assert idx["2008-02-01"] == pytest.approx(0.6 * 104.0 + 0.4 * 105.0)


def test_index_asof_returns_empty_when_the_base_month_is_not_yet_known():
    v = {"a": {"2009-01-01": [("2015-03-13", 100.0)]},
         "b": {"2009-01-01": [("2015-03-13", 200.0)]}}
    assert dcgrade.index_asof(v, "2015-03-13", W, base_month="2008-01-01") == {}


def test_index_asof_intersects_component_dates():
    """A month only one component has must not enter the headline -- the same
    date-intersection contract aggregate.headline uses."""
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2008-02-01": [("2015-03-13", 102.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)]}}
    idx = dcgrade.index_asof(v, "2015-03-13", W, base_month="2008-01-01")
    assert list(idx) == ["2008-01-01"]


def test_index_asof_ignores_observations_dated_after_the_cutoff():
    """A vintage published on date D can carry obs months <= D only."""
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2020-01-01": [("2015-03-13", 150.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)],
               "2020-01-01": [("2015-03-13", 260.0)]}}
    idx = dcgrade.index_asof(v, "2015-03-13", W, base_month="2008-01-01")
    assert "2020-01-01" not in idx


def test_anchors_dedupe_by_last_observation_month():
    """Multiple ALFRED vintages can share a last-observation month. Grading
    each would inflate n and the independent-draw estimate without adding
    information (spec 5.1)."""
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2008-02-01": [("2015-03-13", 102.0), ("2015-04-14", 104.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)],
               "2008-02-01": [("2015-03-13", 210.0), ("2015-04-14", 211.0)]}}
    out = dcgrade.anchors(v, W, base_month="2008-01-01")
    assert [m for m, _ in out] == ["2008-02-01"]


def test_anchors_returns_one_entry_per_new_last_month_in_order():
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2008-02-01": [("2015-04-14", 104.0)],
               "2008-03-01": [("2015-05-14", 106.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)],
               "2008-02-01": [("2015-04-14", 211.0)],
               "2008-03-01": [("2015-05-14", 214.0)]}}
    out = dcgrade.anchors(v, W, base_month="2008-01-01")
    assert [m for m, _ in out] == ["2008-01-01", "2008-02-01", "2008-03-01"]
