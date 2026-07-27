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


def _flat_index(start="2010-01-01", n=200, monthly=1.0):
    from pipeline.dates import months_back
    return {months_back(start, -i): 100.0 * (monthly ** i) for i in range(n)}


def test_grade_reports_zero_shortfall_when_carried_matches_realized():
    """A constant-rate index: every basis carries exactly what happens."""
    idx = _flat_index(monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]
    out = dcgrade.grade(ab, idx, horizons=(12,))
    st = out["trailing_3yr"]["h12"]
    assert st["shortfall_rate_pct"] == pytest.approx(0.0)
    assert st["mae_pp"] == pytest.approx(0.0, abs=1e-9)
    assert st["worst_shortfall_pp"] == pytest.approx(0.0)


def test_grade_counts_a_shortfall_when_realized_exceeds_carried():
    """Escalation accelerates after the anchor, so every carry is short.

    Graded anchors are indices 48-58 (2014-01 through 2014-11 in this
    fixture), not the full 36:59 slice the original draft used. The fixture
    breaks into the fast regime at index 60: current_momentum's 12-month
    lookback from an anchor at index a reaches back to a-12, so as long as
    a >= 48 that lookback window (a-12 .. a) sits entirely inside the slow
    0.1%/month regime, while the target a+12 (60..70) sits entirely inside
    the accelerated 2%/month regime. That makes every graded anchor's carry
    a genuine underestimate of what followed -- not a coin-flip around zero.
    Anchors 36-47 were excluded because their targets (48-59) are STILL in
    the slow regime, so carried ~= realized there and the sign of the
    (near-zero) error is floating-point noise, not signal -- that made the
    original 100% assertion land near 50% and flap."""
    from pipeline.dates import months_back
    idx = {months_back("2010-01-01", -i): 100.0 * (1.001 ** i) for i in range(60)}
    for i in range(60, 120):                      # regime shift upward
        idx[months_back("2010-01-01", -i)] = idx[months_back("2010-01-01", -59)] \
            * (1.02 ** (i - 59))
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[48:59]]
    out = dcgrade.grade(ab, idx, horizons=(12,))
    st = out["current_momentum"]["h12"]
    assert st["shortfall_rate_pct"] == pytest.approx(100.0)
    assert st["bias_pp"] < 0          # carried less than realized
    assert st["mean_shortfall_pp"] > 0


def test_grade_reports_independent_draws_as_n_over_h():
    """independent_draws must equal n/h at every horizon, for every basis --
    including long_run.

    The original fixture started at 2010-01-01, but long_run measures from
    SAMPLE_START (2007-12-01). Since that date was absent from the index,
    bases_at returned None for long_run at every anchor, grade() emitted
    None for every long_run horizon, and this test's `st["n"]` subscripted
    None -- a TypeError, not a real check of long_run's behaviour. Building
    the fixture from SAMPLE_START instead makes long_run resolve like the
    other two bases, so the n/h invariant is actually exercised for all
    three ROLLING_BASES this test claims to cover, not just two of them."""
    idx = _flat_index(start=dcgrade.SAMPLE_START, monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]
    out = dcgrade.grade(ab, idx, horizons=(12, 48))
    checked = 0
    for basis in dcgrade.ROLLING_BASES:
        for h in (12, 48):
            st = out[basis][f"h{h}"]
            assert st is not None, (
                f"{basis} h{h} graded no anchors -- fixture regressed")
            assert st["independent_draws"] == pytest.approx(st["n"] / h)
            checked += 1
    assert checked == 6, "expected all 3 bases x 2 horizons to be gradeable"


def test_grade_skips_anchors_with_no_realized_value_at_the_horizon():
    """Anchors within h months of the sample end are not gradeable."""
    idx = _flat_index(n=60, monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:]]
    out = dcgrade.grade(ab, idx, horizons=(12,))
    assert out["trailing_3yr"]["h12"]["n"] == len(ab) - 12


def test_grade_emits_no_row_for_a_horizon_with_no_gradeable_anchors():
    idx = _flat_index(n=40, monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:]]
    out = dcgrade.grade(ab, idx, horizons=(48,))
    assert out["trailing_3yr"]["h48"] is None


def test_grade_never_emits_a_scenario_key():
    """The two hindsight-selected regimes carry no grading statistic
    anywhere (spec 5.3, acceptance criterion 4)."""
    idx = _flat_index(monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]
    out = dcgrade.grade(ab, idx)
    assert set(out) == set(dcgrade.ROLLING_BASES)
    assert "gfc" not in out and "covid_peak" not in out


def test_realized_at_annualizes_forward_from_the_anchor():
    idx = _flat_index(monthly=1.005)
    m = sorted(idx)[0]
    r = dcgrade.realized_at(idx, m, (12,))
    assert r["h12"] == pytest.approx(((1.005 ** 12) - 1) * 100)


def test_grade_honours_a_reduced_horizon_tuple_passed_positionally():
    """A later task publishes a reduced horizon set for one of the two
    samples by calling grade(anchor_bases, realized_index, horizons)
    positionally with e.g. (12, 24). Output must carry exactly those
    horizons for every basis -- no silent fallback to the full HORIZONS,
    and no requirement that the caller pass all four to get a usable
    result. Built from SAMPLE_START (like the independent-draws test) so
    long_run resolves too, not just the two lookback-bounded bases."""
    idx = _flat_index(start=dcgrade.SAMPLE_START, monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]
    out = dcgrade.grade(ab, idx, (12, 24))
    for basis in dcgrade.ROLLING_BASES:
        assert set(out[basis]) == {"h12", "h24"}
        assert out[basis]["h12"] is not None
        assert out[basis]["h24"] is not None
        assert out[basis]["h12"]["independent_draws"] == \
            pytest.approx(out[basis]["h12"]["n"] / 12)
        assert out[basis]["h24"]["independent_draws"] == \
            pytest.approx(out[basis]["h24"]["n"] / 24)


def test_grade_computes_realized_via_realized_at_not_a_second_formula():
    """grade()'s realized side must be realized_at()'s output, not a
    re-derived duplicate -- otherwise the two definitions of "realized"
    could silently diverge. Verified by monkeypatching realized_at to a
    stub that returns an obviously-wrong constant: if grade() actually
    calls it, every carried rate reads as short against that constant."""
    idx = _flat_index(monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]

    real_realized_at = dcgrade.realized_at
    calls = []

    def fake_realized_at(realized_index, anchor_month, horizons=dcgrade.HORIZONS):
        calls.append((anchor_month, tuple(horizons)))
        return {f"h{h}": 10_000.0 for h in horizons}   # absurdly high "realized"

    dcgrade.realized_at = fake_realized_at
    try:
        out = dcgrade.grade(ab, idx, (12,))
    finally:
        dcgrade.realized_at = real_realized_at

    assert calls, "grade() never called realized_at()"
    st = out["trailing_3yr"]["h12"]
    # against a realized of 10,000%, every real carried rate is a shortfall
    assert st["shortfall_rate_pct"] == pytest.approx(100.0)


# ---------------------------------------------------------------------------
# build(): both legs, scenarios, the re-derivable anchor array.
#
# This repo permits exactly ONE live-data test in the whole suite --
# test_reconstruction_matches_the_published_build_index above. Every other
# test, including everything below, builds a synthetic store: real config
# (dc_basket.json, series.json) but fabricated observations, so the fixture
# never drifts with a daily bot commit and never disagrees with a change to
# the live store.
# ---------------------------------------------------------------------------

from pipeline.dates import months_back as _months_back
from pipeline.models import Observation

# The 12 real Build components' STORE series codes (config, not data --
# reading these off dc_basket.json's own component list would be circular
# with what this fixture is trying to independently exercise).
DC_BUILD_SERIES = (
    "ces_constr_ahe", "ppi_elec_contr", "ppi_plumb_hvac", "ppi_steel",
    "ppi_concrete", "ppi_copper_wire", "ppi_alum_shapes", "ppi_switchgear",
    "ppi_transformer", "ppi_genset", "ppi_hvac_equip", "ppi_pumps",
)

SCENARIOS = [
    {"key": "gfc", "label": "GFC downturn",
     "start_month": "2008-12-01", "end_month": "2011-12-01"},
    {"key": "covid_peak", "label": "COVID peak",
     "start_month": "2021-04-01", "end_month": "2023-12-01"},
]


def _regime_rate(month: str) -> float:
    """Monthly growth rate for one shared synthetic DC-index trajectory,
    2007-12 through 2026-06.

    Piecewise, not constant, and not deliberately: a flat-rate fixture makes
    long_run/trailing_3yr/current_momentum agree at every anchor (the exact
    trap `test_bases_at_computes_the_three_rolling_bases_from_their_own_windows`
    above was written to avoid), and it would make the GFC/COVID scenario
    reads indistinguishable from the surrounding trend. The regimes below
    give both a real decline (2008-12..2009-12, so the extended leg's
    long-run basis and the 'gfc' scenario read as genuinely negative and the
    leg legitimately 'contains a downturn') and a real acceleration
    (2021-05..2022-06, so 'covid_peak' reads as genuinely elevated)."""
    if month < "2008-12-01":
        return 0.0030            # pre-GFC rise
    if month < "2010-01-01":
        return -0.0100           # GFC decline
    if month < "2012-01-01":
        return 0.0020            # recovery
    if month < "2021-05-01":
        return 0.0025            # steady mid-cycle (spans BASE_MONTH 2018-01)
    if month < "2022-07-01":
        return 0.0080            # COVID-era acceleration
    if month < "2024-01-01":
        return 0.0020            # cooldown
    return 0.0025                # steady


def _monthly_index_levels(start="2007-12-01", end="2026-06-01") -> dict[str, float]:
    """{month: level}, monthly, compounding _regime_rate from 100.0 at start."""
    months = []
    m = start
    while m <= end:
        months.append(m)
        m = _months_back(m, -1)
    levels = {months[0]: 100.0}
    for prev, cur in zip(months, months[1:]):
        levels[cur] = levels[prev] * (1 + _regime_rate(cur))
    return levels


def _write_synthetic_dc_store(store_dir) -> None:
    """A synthetic vintage store for the 12 real Build components: monthly
    observations 2007-12 through 2026-06, each carrying TWO vintages -- a
    provisional first release one month after the observation month, and a
    (slightly higher) revision three months after that -- so the strict leg
    has vintage history to walk and the anchors() dedupe-by-last-month logic
    has real month-by-month vintage arrivals to exercise, not one big vintage
    dump. Every one of the 12 series shares the same growth trajectory
    (scaled by an arbitrary per-series level that cancels on rebase), which
    keeps the fixture's arithmetic hand-checkable while still varying over
    time -- see `_regime_rate`.

    Written directly as store-format JSONL (bypassing vintage.append_vintages,
    which opens each partition file once per observation) because this
    fixture is ~5,300 rows; the module-scoped `dc_built` fixture below still
    pays this cost only once for the whole test module.
    """
    import json
    from dataclasses import asdict

    levels = _monthly_index_levels()
    by_vintage_month: dict[str, list[dict]] = {}
    for i, code in enumerate(DC_BUILD_SERIES):
        scale = 1.0 + i * 0.1        # arbitrary per-series level; cancels on rebase
        for month, level in levels.items():
            final_value = level * scale
            provisional_value = final_value * 0.998   # small systematic revision
            for value, vintage_date in (
                (provisional_value, _months_back(month, -1)),
                (final_value, _months_back(month, -4)),
            ):
                o = Observation(series_code=code, obs_date=month, value=value,
                                vintage_date=vintage_date, source="test",
                                route="synthetic")
                by_vintage_month.setdefault(vintage_date[:7], []).append(asdict(o))

    obs_dir = Path(store_dir) / "obs"
    obs_dir.mkdir(parents=True, exist_ok=True)
    for ym, rows in by_vintage_month.items():
        (obs_dir / f"{ym}.jsonl").write_text(
            "\n".join(json.dumps(r, sort_keys=True) for r in rows) + "\n")


@pytest.fixture(scope="module")
def dc_built(tmp_path_factory):
    """build() run once against the synthetic store above, reused read-only
    across every test below -- build() and its inputs are pure functions of
    the store's contents, so re-writing ~5,300 rows and re-loading the store
    per test would only slow the suite without exercising anything new."""
    store_dir = tmp_path_factory.mktemp("dc_grade_store")
    _write_synthetic_dc_store(store_dir)
    conn = vintage.load(store_dir)
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    return dcgrade.build(conn, baskets["build"], dcgrade.BASE_MONTH, SCENARIOS)


def test_build_emits_both_legs_with_spans_and_anchor_counts(dc_built):
    out = dc_built
    assert set(out["legs"]) == {"strict", "extended"}
    for leg in out["legs"].values():
        assert leg["anchors_n"] > 50
        assert leg["span"][0] < leg["span"][1]
        assert leg["grades"]
        # A bare truthiness check on the outer dict would pass even if every
        # basis/horizon graded to None (e.g. a wiring bug that fed grade()
        # anchors with no realized future) -- assert something actually
        # graded.
        assert any(stat is not None
                  for basis_grades in leg["grades"].values()
                  for stat in basis_grades.values())


def test_strict_leg_is_vintage_true_and_cannot_predate_its_own_base_month(dc_built):
    """Renamed from a stale assertion (`span[0] >= '2015-03'`) inherited from
    before the base-month correction (spec 2.1a): the real floor is 2018-01,
    BASE_MONTH itself -- an index based at 2018-01 cannot be reconstructed at
    a vintage that predates its own base month's observation. On a synthetic
    store the exact span is a fixture detail, so this asserts the PROPERTY
    (no anchor before the base month) rather than a hardcoded calendar date."""
    strict = dc_built["legs"]["strict"]
    assert "vintage-true" in strict["provenance"]
    assert strict["span"][0] >= dcgrade.BASE_MONTH[:7]
    assert strict["contains_downturn"] is False


def test_extended_leg_reaches_further_back_and_holds_a_downturn(dc_built):
    ext, strict = dc_built["legs"]["extended"], dc_built["legs"]["strict"]
    assert ext["span"][0] < strict["span"][0]
    assert ext["span"][0] == "2010-12"      # SAMPLE_START + 36mo of history
    assert ext["contains_downturn"] is True
    assert ext["anchors_n"] > strict["anchors_n"]


def test_scenarios_publish_rates_and_windows_but_no_grading_statistic(dc_built):
    """Spec 5.3: a grade on ~1.5 independent draws is not a measurement, and
    publishing one invites exactly the over-reading it cannot support."""
    out = dc_built
    keys = {s["key"] for s in out["scenarios"]}
    assert keys == {"gfc", "covid_peak"}
    banned = {"shortfall_rate_pct", "mae_pp", "bias_pp", "n",
              "mean_shortfall_pp", "worst_shortfall_pp", "independent_draws"}
    for s in out["scenarios"]:
        assert s["hindsight_selected"] is True
        assert s["annualized_pct"] is not None
        assert not (banned & set(s)), f"scenario {s['key']} carries a grade"
    # The two scenarios must read as genuinely different regimes -- not both
    # incidentally landing near the fixture's steady-state rate, which would
    # let a swapped start/end month or a broken window slice pass unnoticed.
    by_key = {s["key"]: s["annualized_pct"] for s in out["scenarios"]}
    assert by_key["gfc"] < 0 < by_key["covid_peak"]


def test_anchors_array_lets_a_reader_rederive_every_statistic(dc_built):
    out = dc_built
    assert out["anchors"]
    row = out["anchors"][0]
    assert set(row) == {"m", "leg", "bases", "realized"}
    assert set(row["bases"]) == set(dcgrade.ROLLING_BASES)
    assert set(row["realized"]) == {f"h{h}" for h in dcgrade.HORIZONS}


def test_build_publishes_the_revision_disclosure(dc_built):
    """The extended leg's justification is the measured revision distortion.
    Without it the leg is just a looser standard (spec 5.2).

    The bound is DERIVED from the artifact's own anchor rows on every build
    -- max |vintage-true - final-revision| carried rate over every basis at
    every anchor month both legs share -- so it can never again contradict
    the rows published beside it. (Its predecessor, a hand-measured 0.27
    constant from nine pre-backfill anchors, was exceeded 2.5x -- 0.672pp at
    2022-04, current_momentum -- by the first fully backfilled artifact.)"""
    strict = {r["m"]: r["bases"] for r in dc_built["anchors"]
              if r["leg"] == "strict"}
    ext = {r["m"]: r["bases"] for r in dc_built["anchors"]
           if r["leg"] == "extended"}
    diffs = [abs(s - e)
             for m in set(strict) & set(ext)
             for k in dcgrade.ROLLING_BASES
             if (s := strict[m][k]) is not None
             and (e := ext[m].get(k)) is not None]
    assert diffs, "no overlapping anchors -- the assertion below is vacuous"
    assert dc_built["revision_disclosure_pp"] == \
        pytest.approx(round(max(diffs), 3))
    # The extended leg's provenance note quotes the same measured figure --
    # prose and number publish from one derivation, or the note drifts the
    # way the hardcoded power-nowcast string once did.
    assert f'{dc_built["revision_disclosure_pp"]}pp' \
        in dc_built["legs"]["extended"]["provenance"]


def test_strict_leg_never_publishes_h36_or_h48(dc_built):
    """Correction: independent draws at h36/h48 measure ~1.78 and ~1.08 on
    the real vintage sample -- roughly ONE draw -- so the strict leg must
    carry only h12/h24. This is the ONLY stated exception to the paired-leg
    rule (every other published shortfall figure has a counterpart leg
    beside it), and it must never silently regress to publishing all four
    horizons the way the extended leg does."""
    strict = dc_built["legs"]["strict"]
    extended = dc_built["legs"]["extended"]
    assert strict["published_horizons"] == [12, 24]
    assert extended["published_horizons"] == list(dcgrade.HORIZONS)
    for basis in dcgrade.ROLLING_BASES:
        assert set(strict["grades"][basis]) == {"h12", "h24"}
        assert set(extended["grades"][basis]) == {"h12", "h24", "h36", "h48"}
