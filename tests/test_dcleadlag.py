"""P3c is a MEASUREMENT, not a model. No transfer coefficient is estimated
anywhere: turning a correlation into a price forecast requires an elasticity,
and fitting one on this sample is the overfit the register warns about."""
import sqlite3

import pytest

from pipeline.engine import dcleadlag


def _series(values, start="2000-01-01"):
    from pipeline.dates import months_back
    return {months_back(start, -i): v for i, v in enumerate(values)}


def test_correlate_finds_a_planted_lead_at_the_right_lag():
    """Driver leads target by 6 months -> peak correlation at lag 6, exactly.

    The target's first 6 months are zero-padding, not part of the planted
    signal (there is no driver history before month 0 to shift into them).
    Checked directly: at every lag < 6 those padded zeros get paired against
    real driver values and pull the correlation down; at lag 6 the pairing
    starts exactly where the shifted copy of `base` begins, so xs == ys
    exactly and the correlation is 1.0, not merely "high." Asserting the
    exact value (not just > 0.9) is what rules out "close but ambiguous."
    """
    import math
    base = [math.sin(i / 6.0) for i in range(240)]
    driver = _series(base)
    target = _series([0.0] * 6 + base[:-6])
    prof = dcleadlag.correlate(driver, target, max_lag=12)
    best = max(prof, key=lambda p: p[1])
    assert best[0] == 6
    assert best[1] == pytest.approx(1.0, abs=1e-9)
    # and it's not merely a local max: every other lag is strictly worse.
    assert all(c < best[1] for lag, c in prof if lag != 6)


def test_correlate_returns_one_entry_per_lag_from_zero():
    prof = dcleadlag.correlate(_series([float(i) for i in range(60)]),
                               _series([float(i) for i in range(60)]),
                               max_lag=5)
    assert [lag for lag, _ in prof] == [0, 1, 2, 3, 4, 5]


def test_correlate_returns_none_correlation_when_overlap_is_too_short():
    """Only 2 months of data anywhere: every lag's overlap is well under
    MIN_OVERLAP, so every entry must be None -- not just the ones past lag 1.
    Restricting the assertion to `lag > 1` would let a bug that special-cased
    lag 0 or 1 slip through unnoticed."""
    prof = dcleadlag.correlate(_series([1.0, 2.0]), _series([1.0, 2.0]),
                               max_lag=24)
    assert all(c is None for _, c in prof)


def test_correlate_handles_a_flat_series_without_dividing_by_zero():
    prof = dcleadlag.correlate(_series([5.0] * 60), _series([float(i) for i in range(60)]),
                               max_lag=6)
    assert all(c is None for _, c in prof)


def test_mappings_cover_forty_five_percent_of_build_weight():
    assert sum(m["weight"] for m in dcleadlag.MAPPINGS) == pytest.approx(0.45)
    assert {m["series"] for m in dcleadlag.MAPPINGS} == {
        "fred_uo_electrical", "fred_uo_hvac", "fred_uo_turbines"}


def test_stability_verdict_requires_agreement_across_both_halves():
    """The gate is stated before the numbers exist: consistent sign and best
    lag within +/-3 months across split halves, or it is a negative result."""
    assert dcleadlag.stable(first_lag=6, second_lag=8,
                            first_corr=0.7, second_corr=0.6) is True
    assert dcleadlag.stable(first_lag=2, second_lag=14,
                            first_corr=0.7, second_corr=0.6) is False
    assert dcleadlag.stable(first_lag=6, second_lag=7,
                            first_corr=0.7, second_corr=-0.6) is False
    assert dcleadlag.stable(first_lag=None, second_lag=6,
                            first_corr=None, second_corr=0.6) is False


def test_stability_verdict_boundary_is_inclusive_at_exactly_the_tolerance():
    """Pins the exact +/-3 boundary the docstring promises: neither of the
    two cases above touches lag_diff == LAG_TOLERANCE or == LAG_TOLERANCE + 1,
    so a stray `<` vs `<=` regression at the boundary would pass unnoticed
    without this."""
    assert dcleadlag.LAG_TOLERANCE == 3
    assert dcleadlag.stable(first_lag=4, second_lag=7,
                            first_corr=0.5, second_corr=0.5) is True
    assert dcleadlag.stable(first_lag=4, second_lag=8,
                            first_corr=0.5, second_corr=0.5) is False


def test_study_publishes_no_transfer_coefficient():
    """A correlation is not an elasticity. Nothing downstream of the lead
    structure -- no fitted coefficient, elasticity, pass-through or forecast
    -- may be computed or published anywhere in this module (spec 6).

    The constraint has no behavioural surface to call and assert against (an
    unused, uncomputed quantity leaves no trace in any function's output), so
    this has to read the module's own source -- but it reads it as an AST,
    not raw text. Two things that fixes:

    1. Path independence: `inspect.getsource` resolves the module through the
       import system, not a string relative to the process's cwd, so this
       cannot silently pass-by-not-finding-the-file when pytest's cwd isn't
       the repo root.
    2. Precision: a raw substring scan (matching `'"elasticity"'` anywhere in
       the file) would either have to quote-guard every banned word -- and
       this module's own docstring uses several of them in plain English,
       unquoted, to explain what it deliberately does NOT do -- or risk
       flagging that prose. Walking the AST and checking actual identifiers
       (assigned names, dict keys, function/argument names) checks the thing
       that actually matters -- would a real computation or published field
       be named one of these -- without caring what the docstring says in
       English.
    """
    import ast
    import inspect

    banned = {"beta", "elasticity", "pass_through", "coefficient", "forecast"}
    tree = ast.parse(inspect.getsource(dcleadlag))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            found.add(node.id.lower())
        elif isinstance(node, ast.arg):
            found.add(node.arg.lower())
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            found.add(node.name.lower())
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if node.value.lower() in banned:
                found.add(node.value.lower())
    assert not (found & banned), found & banned


def _conn_with(rows: dict[str, dict[str, float]]) -> sqlite3.Connection:
    """A minimal in-memory store matching vintage.load's schema, so study()
    can be exercised end-to-end through vintage.latest without touching disk."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    for series_code, obs in rows.items():
        for obs_date, value in obs.items():
            conn.execute(
                "INSERT INTO observations VALUES (?, ?, ?, ?, 'FRED', 'API')",
                (series_code, obs_date, value, obs_date))
    conn.commit()
    return conn


class _Comp:
    """Just enough of DCComponent's shape for study(): code, series, label,
    weight. A local stand-in keeps this test from depending on dc_basket's
    validation (weights summing to 1, registry membership) it doesn't need."""
    def __init__(self, code, series, label, weight):
        self.code, self.series, self.label, self.weight = code, series, label, weight


def _level_series(n_months, fn, start="1995-01-01"):
    from pipeline.dates import months_back
    return {months_back(start, -i): fn(i) for i in range(n_months)}


def test_study_wires_correlate_and_stable_together_end_to_end():
    """study() must actually call the same correlate()/stable() this file
    already pins, and assemble their output faithfully -- not reimplement or
    diverge from the gate logic. Uses 22 years of arbitrary (not planted)
    monthly levels: enough for two YoY halves each well past MIN_OVERLAP even
    after a lag reduction, without needing the messy inversion of a YoY-domain
    lead into level-domain fixtures that a "real" plant would require."""
    import math

    n = 22 * 12
    driver_levels = _level_series(n, lambda i: 100 + 8 * math.sin(i / 5.0))
    target_levels = _level_series(n, lambda i: 50 + 3 * math.cos(i / 7.0) + i * 0.01)

    conn = _conn_with({"fred_uo_electrical": driver_levels, "ppi_switchgear": driver_levels,
                       "some_component": target_levels})
    components = [_Comp("some_component", "some_component", "Some component", 0.14)]
    mapping = [{"series": "fred_uo_electrical", "label": "Electrical equipment",
               "components": ["some_component"], "weight": 0.14}]

    result = dcleadlag.study(conn, components, mappings=mapping)

    assert set(result) == {"mappings", "weight_covered", "weight_stable", "verdict", "gate"}
    assert result["weight_covered"] == pytest.approx(0.14)
    assert len(result["mappings"]) == 1
    row = result["mappings"][0]
    assert set(row) == {
        "driver", "driver_label", "component", "component_label", "weight",
        "months", "span", "best_lag_months", "best_correlation", "profile",
        "first_half", "second_half", "stable"}
    assert row["driver"] == "fred_uo_electrical"
    assert row["component"] == "some_component"
    assert row["months"] > 100

    # The row's own verdict must be exactly what calling stable() on its own
    # published first/second-half numbers would say -- not a second,
    # independently-computed judgment that could silently disagree.
    expected_stable = dcleadlag.stable(
        row["first_half"]["best_lag_months"], row["second_half"]["best_lag_months"],
        row["first_half"]["best_correlation"], row["second_half"]["best_correlation"])
    assert row["stable"] is expected_stable

    supported_weight = sum(r["weight"] for r in result["mappings"] if r["stable"])
    assert result["weight_stable"] == pytest.approx(supported_weight)
    if row["stable"]:
        assert "stable lead was found for 1 of 1" in result["verdict"]
    else:
        assert "No mapping showed a lead stable" in result["verdict"]


def test_study_skips_a_mapping_component_absent_from_the_basket():
    """A mapping naming a component code that isn't in the passed-in basket
    (e.g. a variant that doesn't carry it) must be skipped, not KeyError."""
    conn = _conn_with({"fred_uo_electrical": _level_series(48, lambda i: 100 + i)})
    mapping = [{"series": "fred_uo_electrical", "label": "Electrical equipment",
               "components": ["missing_component"], "weight": 0.14}]
    result = dcleadlag.study(conn, components=[], mappings=mapping)
    assert result["mappings"] == []
    assert "No mapping showed a lead stable" in result["verdict"]
