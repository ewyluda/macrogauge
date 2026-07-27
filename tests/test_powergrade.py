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


def test_note_is_derived_from_the_verdict_not_asserted():
    """The published sentence must follow the gate, not outlive it.

    The page used to assert "it lost to simple carry-forward" beside numbers
    that were recomputed every run: a flip to PASS would have printed a
    falsehood next to correct figures. Every verdict must therefore map to a
    DIFFERENT sentence, and no sentence may claim the loss under a verdict
    that isn't FAIL."""
    notes = {v: powergrade.note(v)
             for v in ("FAIL", "PASS", "INSUFFICIENT")}
    assert len(set(notes.values())) == 3
    assert "lost to simple carry-forward" in notes["FAIL"]
    for v in ("PASS", "INSUFFICIENT"):
        assert "lost to" not in notes[v]
    # The standing position (index unchanged, machinery config-gated) holds
    # under every outcome -- clearing the backtest is a precondition for
    # changing the index, not the change itself.
    for text in notes.values():
        assert "config-gated" in text
    # An unknown verdict must not fall through to the FAIL claim.
    assert "lost to" not in powergrade.note("SOMETHING_NEW")


def test_run_publishes_the_note_that_matches_its_own_verdict():
    conn = _store_where_nowcast_loses()
    out = powergrade.run(conn)
    assert out["note"] == powergrade.note(out["verdict"])


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


def _official_and_live_with_a_negative_wholesale_stretch():
    """Handcrafted inputs where the sign guard splits the gradeable sets.

    Wholesale runs at a flat +10 until 2025-09-01 and then a deeply negative
    -50 (negative smoothed wholesale is real -- blend.splice_year_ratio's own
    docstring). For the 2025-11 target the entire nowcast tail falls inside
    the negative stretch: every lambda > 0 model goes non-positive there and
    is skipped by the sign guard, while lambda = 0 (pure official carry)
    still grades it. The 2025-10 target's tail still reaches positive
    wholesale dates, so every lambda grades it."""
    from datetime import date, timedelta
    from pipeline.dates import months_back
    official = {}
    for i in range(36):
        m = months_back("2023-01-01", -i)
        official[m] = 8.0 + i * 0.02
    live = {}
    d = date(2024, 8, 1)
    while d <= date(2025, 12, 31):
        live[d.isoformat()] = 10.0 if d <= date(2025, 9, 1) else -50.0
        d += timedelta(days=1)
    return official, live


def test_grade_all_returns_the_months_the_sign_guard_dropped():
    official, live = _official_and_live_with_a_negative_wholesale_stretch()
    per_lambda, common, dropped, mae, mx, cf_mae = powergrade.grade_all(
        official, live, ["2025-10-01", "2025-11-01"])
    assert dropped == ["2025-11-01"]
    assert common == ["2025-10-01"]
    # The dropped month was genuinely gradeable by lambda=0 -- it is excluded
    # by the common-intersection rule, not missing coverage, which is exactly
    # why it must surface rather than vanish.
    assert "2025-11-01" in per_lambda[0.0]
    assert all("2025-11-01" not in per_lambda[lam]
               for lam in powergrade.LAMBDAS if lam > 0)


def test_run_publishes_the_dropped_months_audit_trail():
    """grade_all's docstring promises no month is silently discarded -- and
    the CLI prints `dropped` to stderr -- but run() used to unpack `dropped`
    and throw it away, so the published artifact showed only a reduced
    months_graded count with no trace of what the intersection rule removed.
    A reader auditing the gate needs the exclusions, not just the total."""
    conn = _store_with_a_negative_wholesale_stretch()
    out = powergrade.run(conn)
    assert out["months_dropped"] >= 1
    assert out["months_dropped"] == len(out["dropped_months"])
    assert out["dropped_months"] == sorted(out["dropped_months"])
    for m in out["dropped_months"]:
        assert len(m) == 7 and m[4] == "-"   # published as YYYY-MM
    # Dropped months are exclusions from the graded set, never members of it.
    assert out["months_graded"] > 0


def _store_with_a_negative_wholesale_stretch():
    import sqlite3
    from datetime import date, timedelta
    from pipeline.dates import months_back
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    rows = []
    for i in range(36):
        m = months_back("2023-01-01", -i)
        rows.append((powergrade.RETAIL, m, 8.0 + i * 0.02, m, "EIA", "API"))
    for hub in powergrade.HUBS:
        d = date(2023, 1, 1)
        while d <= date(2025, 12, 31):
            val = 10.0 if d <= date(2025, 9, 1) else -200.0
            rows.append((hub, d.isoformat(), val, d.isoformat(), "EIA", "API"))
            d += timedelta(days=1)
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
