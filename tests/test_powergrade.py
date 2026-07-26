"""The published negative result must be a published NUMBER, not a React
string literal. It carried no as-of, was in none of the 34 artifacts, was not
schema-validated, and nothing in CI would catch it drifting (spec 7)."""
import pytest

from pipeline.engine import powergrade


def test_month_shift_moves_whole_months_in_both_directions():
    assert powergrade.month_shift("2026-07-01", -12) == "2025-07-01"
    assert powergrade.month_shift("2026-01-01", -1) == "2025-12-01"
    assert powergrade.month_shift("2025-12-01", 1) == "2026-01-01"


def test_run_reports_the_verdict_and_both_maes(monkeypatch):
    """A synthetic store where the nowcast is strictly worse than carrying
    forward -- the shipped verdict.

    Verified (not assumed) by running grade_all() directly against this
    fixture before trusting the assertions below: cf_mae=0.530,
    mae[0.25]=3.287 (the best positive-lambda candidate), so best_mae is
    ~6.2x carry-forward's error -- not a near-tie that could flip on an
    unrelated change."""
    conn = _store_where_nowcast_loses()
    out = powergrade.run(conn)
    assert out["months_graded"] > 0
    assert out["carry_forward_mae"] is not None
    assert out["best_mae"] is not None
    assert out["verdict"] == "FAIL"
    assert out["best_mae"] > out["carry_forward_mae"]


def test_run_degrades_to_nulls_rather_than_raising_on_an_empty_store():
    """The schema must accept a degraded shape; the engine must produce one."""
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    out = powergrade.run(conn)
    assert out["months_graded"] == 0
    assert out["best_mae"] is None
    assert out["verdict"] == "INSUFFICIENT"


def _store_where_nowcast_loses():
    import sqlite3
    from pipeline.dates import months_back
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    rows = []
    for i in range(40):
        m = months_back("2023-01-01", -i)
        rows.append((powergrade.RETAIL, m, 8.0 + i * 0.02, m, "EIA", "API"))
    for hub in powergrade.HUBS:
        for i in range(1200):
            from datetime import date, timedelta
            d = (date(2023, 1, 1) + timedelta(days=i)).isoformat()
            # violent wholesale swings the retail series never inherits
            rows.append((hub, d, 30.0 + 25.0 * ((i // 30) % 2), d, "EIA", "API"))
    conn.executemany("INSERT INTO observations VALUES (?,?,?,?,?,?)", rows)
    conn.commit()
    return conn


# --- _verdict() in isolation ---------------------------------------------
#
# run()'s verdict deliberately does NOT just compare best_mae to
# carry_forward_mae. The script's own gate (scripts/backtest_power_yearratio.py
# main(), spec §6) has always required a candidate to beat BOTH naive
# baselines -- carry-forward AND lambda=0 -- with max|err| <= MAX_ERR_PTS. A
# verdict computed from only the carry-forward comparison is a *different,
# looser* rule than "the same one that has always run": it would report PASS
# in cases the script's exit code still calls FAIL (beats carry-forward and
# beats lambda=0, but blows the max-error ceiling). These tests pin the full
# three-condition rule directly, independent of any store fixture.

def test_verdict_fails_when_beats_both_baselines_but_exceeds_max_error():
    """best beats carry-forward AND beats lambda=0 on MAE, but its max|err|
    is over MAX_ERR_PTS -- the script's real gate still calls this FAIL. A
    verdict rule built from the MAE comparison alone would wrongly PASS it."""
    verdict = powergrade._verdict(
        cf=5.0, best=1.0, zero_lambda_mae=4.0,
        best_max_err=powergrade.MAX_ERR_PTS + 0.01)
    assert verdict == "FAIL"


def test_verdict_passes_only_when_all_three_conditions_hold():
    verdict = powergrade._verdict(
        cf=5.0, best=1.0, zero_lambda_mae=4.0,
        best_max_err=powergrade.MAX_ERR_PTS)
    assert verdict == "PASS"


def test_verdict_fails_when_best_does_not_beat_lambda_zero():
    verdict = powergrade._verdict(
        cf=5.0, best=3.5, zero_lambda_mae=3.0, best_max_err=1.0)
    assert verdict == "FAIL"


@pytest.mark.parametrize("cf,best,zero,max_err", [
    (None, 1.0, 1.0, 1.0),
    (1.0, None, 1.0, 1.0),
    (1.0, 1.0, None, 1.0),
    (1.0, 1.0, 1.0, None),
])
def test_verdict_is_insufficient_when_any_input_is_missing(cf, best, zero, max_err):
    assert powergrade._verdict(cf, best, zero, max_err) == "INSUFFICIENT"
