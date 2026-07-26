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


import json
from pathlib import Path

from pipeline import dc_basket, registry
from pipeline.store import vintage

REPO = Path(__file__).parent.parent


def test_annualized_is_a_ratio_over_the_window_not_a_mean_of_yoy():
    idx = {"2020-01-01": 100.0, "2023-01-01": 133.1}
    # 1.331 ** (1/3) = 1.10 exactly
    assert dcgrade.annualized(idx, "2020-01-01", "2023-01-01") == pytest.approx(10.0)


def test_annualized_returns_none_when_an_endpoint_is_missing():
    idx = {"2020-01-01": 100.0}
    assert dcgrade.annualized(idx, "2020-01-01", "2023-01-01") is None
    assert dcgrade.annualized(idx, "2019-01-01", "2020-01-01") is None


def test_annualized_returns_none_for_a_zero_length_window():
    idx = {"2020-01-01": 100.0}
    assert dcgrade.annualized(idx, "2020-01-01", "2020-01-01") is None


def test_bases_at_computes_the_three_rolling_bases_from_their_own_windows():
    """Each basis must read its OWN window, not just "a" window. A single
    constant growth rate makes all three windows agree regardless of their
    lookback length, so it can't tell a correct 36-vs-12-month mapping from
    a swapped or wrong one (confirmed by mutation: see the plan report).
    This fixture instead uses three DIFFERENT per-month rates over three
    non-overlapping eras -- older than 36 months back, 12-36 months back,
    and the most recent 12 months -- so long_run, trailing_3yr and
    current_momentum land on three distinct values, each only reproducible
    by reading the correct number of months back from the anchor."""
    n_months = 200
    r_old, r_mid, r_recent = 0.003, 0.006, 0.010
    idx = {dcgrade.SAMPLE_START: 100.0}
    level = 100.0
    for n in range(1, n_months + 1):
        months_before_anchor = n_months - n
        rate = (r_recent if months_before_anchor < 12
                 else r_mid if months_before_anchor < 36 else r_old)
        level *= (1 + rate)
        idx[months_back_forward(dcgrade.SAMPLE_START, n)] = level
    anchor = max(idx)

    b = dcgrade.bases_at(idx, anchor)

    expected_current_momentum = ((1 + r_recent) ** 12 - 1) * 100
    expected_trailing_3yr = (((1 + r_mid) ** 24 * (1 + r_recent) ** 12)
                              ** (12 / 36) - 1) * 100
    expected_long_run = (((1 + r_old) ** (n_months - 36) * (1 + r_mid) ** 24
                          * (1 + r_recent) ** 12) ** (12 / n_months) - 1) * 100

    assert b["current_momentum"] == pytest.approx(expected_current_momentum)
    assert b["trailing_3yr"] == pytest.approx(expected_trailing_3yr)
    assert b["long_run"] == pytest.approx(expected_long_run)
    # the three eras carry different rates, so a correct read of three
    # different-length windows MUST land on three different values -- this
    # is exactly what a constant rate could never exercise
    distinct = {round(b["current_momentum"], 6), round(b["trailing_3yr"], 6),
                round(b["long_run"], 6)}
    assert len(distinct) == 3


def test_bases_at_returns_none_when_the_lookback_predates_the_sample():
    idx = {"2020-01-01": 100.0, "2020-02-01": 101.0}
    b = dcgrade.bases_at(idx, "2020-02-01")
    assert b["trailing_3yr"] is None
    assert b["current_momentum"] is None


def months_back_forward(d, n):
    from pipeline.dates import months_back
    return months_back(d, -n)


def test_reconstruction_matches_the_published_build_index():
    """The harness must grade the PUBLISHED index, not a parallel one
    (spec 9 criterion 5). Compared as agreement between two computations
    rather than a pinned constant: the rolling bases drift every publish, so
    a hardcoded +5.02% would be a fresh staleness bug.

    The trailing two months are excluded: the published index splices the
    copper/aluminium live proxies there and this reconstruction is PPI-only.
    P3a spec 3.1 measured that difference at 1.241 index points in the splice
    month and 0.000 everywhere else.

    The tolerance is a SHAPE, not a flat bound: no month may diverge by more
    than 0.15, and at most one month may diverge by more than 0.05. A wrong
    rebase base month (this module's own Task 3 defect: grading at 2008-01
    against a basket published at 2018-01) moves MANY months by >1 point --
    that is what this test exists to catch. It tolerates exactly one small
    residual (~0.11 at 2020-07 as of this writing) that a single-component
    data revision landing after the committed file's last regenerate can
    explain, without loosening the bound enough to hide a real regression.

    This is the ONE live-data test in this suite (every other test in this
    file builds a synthetic store). It must skip, not fail, when the
    precondition it needs can't be met honestly: the store hasn't been
    vintage-backfilled at all (idx comes back empty), or too little history
    overlaps the published file to say anything.
    """
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    build = baskets["build"]
    weights = {c.code: c.weight for c in build}

    conn = vintage.load(REPO / "store")
    versions = dcgrade.load_component_versions(conn, build)
    vintage_dates = {vd for v in versions.values() for rows in v.values()
                     for vd, _ in rows}
    if len(vintage_dates) < len(build):
        pytest.skip(
            f"store carries only {len(vintage_dates)} distinct vintage dates "
            "for the Build components -- no ALFRED point-in-time history to "
            "reconstruct from (run scripts/backfill_dc_vintages.py)")

    latest = max(vintage_dates)
    idx = dcgrade.index_asof(versions, latest, weights)
    if not idx:
        pytest.skip("reconstruction produced no index -- store lacks the "
                    f"base month ({dcgrade.BASE_MONTH}) for one or more "
                    "Build components")

    published = json.loads(
        (REPO / "site/public/data/datacenter.json").read_text())
    monthly = published["indexes"]["build"]["monthly"]
    pub = dict(zip(monthly["months"], monthly["index"]))

    common = sorted(set(m[:7] for m in idx) & set(pub))[:-2]
    if len(common) <= 150:
        pytest.skip(f"only {len(common)} overlapping months -- too little "
                    "shared history between the reconstruction and the "
                    "published file to compare meaningfully")

    # both are 2018-01=100 up to a constant; rescale ours onto theirs
    ours = {m[:7]: v for m, v in idx.items()}
    k = pub[common[0]] / ours[common[0]]
    diffs = {m: abs(ours[m] * k - pub[m]) for m in common}
    worst = max(diffs.values())
    over_tolerance = sum(1 for d in diffs.values() if d > 0.05)
    assert worst < 0.15, f"reconstruction diverges by {worst:.4f} index points"
    assert over_tolerance <= 1, (
        f"{over_tolerance} months diverge by more than 0.05 index points "
        "-- a real regression moves many months, not one")
