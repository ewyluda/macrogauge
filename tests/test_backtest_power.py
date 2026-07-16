"""Grading math for the wave-4b backtest gate (spec §6) — this script
decides a production config flip, so its arithmetic is test-pinned."""
import importlib.util
import pathlib

import pytest

_spec = importlib.util.spec_from_file_location(
    "backtest_power_yearratio",
    pathlib.Path(__file__).parent.parent / "scripts" / "backtest_power_yearratio.py")
bt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bt)

# Hand-computed fixture (grading t = 2026-02-15, retail cutoff t-75d =
# 2025-12-02 → T0 = 2025-11-01):
#   anchor: W(T0)→2025-10-30=30, W(T0-365d)→2024-10-30=30,
#           official_ffill(2024-11-01)=10.0 → m0 = 10.0, anchor = 1.0
#   tail 2026-02-10: W=36, W(2025-02-10)→2025-02-08=30,
#           official_ffill(2025-02-10)=10.0, λ=0.5 → nowcast = 11.0
#   realized 2026-02 = 10.4, base 2025-02 = 10.0
#   err = (11.0-10.4)/10.0*100 = +6.0 YoY pts
#   carry-forward = (10.0-10.4)/10.0*100 = -4.0 YoY pts
OFFICIAL = {"2024-11-01": 10.0, "2025-02-01": 10.0,
            "2025-11-01": 10.0, "2026-02-01": 10.4}
W = {"2024-10-30": 30.0, "2025-02-08": 30.0,
     "2025-10-30": 30.0, "2026-02-10": 36.0}


def test_month_shift():
    assert bt.month_shift("2026-02-01", -12) == "2025-02-01"
    assert bt.month_shift("2025-01-01", -12) == "2024-01-01"


def test_grade_month_hand_computed():
    err, cf = bt.grade_month(OFFICIAL, W, "2026-02-01", lam=0.5)
    assert err == pytest.approx(6.0)
    assert cf == pytest.approx(-4.0)


def test_grade_month_masks_wholesale_after_grading_date():
    # an obs after the grading date (t = 2026-02-15) must not exist yet
    w = {**W, "2026-02-20": 999.0}
    assert bt.grade_month(OFFICIAL, w, "2026-02-01", lam=0.5) == \
        pytest.approx(bt.grade_month(OFFICIAL, W, "2026-02-01", lam=0.5))


def test_grade_month_honors_retail_availability_lag():
    # a print inside the 75d embargo (2026-01-01 print, cutoff 2025-12-02)
    # must not become the anchor, however tempting
    official = {**OFFICIAL, "2026-01-01": 20.0}
    assert bt.grade_month(official, W, "2026-02-01", lam=0.5) == \
        pytest.approx(bt.grade_month(OFFICIAL, W, "2026-02-01", lam=0.5))


def test_grade_month_missing_coverage_returns_none():
    # no W near the anchor -> ungraded month, never a zero-filled row
    w = {"2026-02-10": 36.0}
    assert bt.grade_month(OFFICIAL, w, "2026-02-01", lam=0.5) is None
    # target or base month missing from official -> ungraded
    assert bt.grade_month({"2025-02-01": 10.0}, W, "2026-02-01", lam=0.5) is None


# grade_all fixture: a CLEAN month (2022-02-01, identical shape/arithmetic
# to the OFFICIAL/W fixture above, shifted back 4y so its dates never
# collide with the POISON month's own official prints below) plus a POISON
# month (2022-05-01) whose tail wholesale ratio is deliberately negative.
#
# CLEAN 2022-02-01: cutoff 2021-12-02 -> T0=2021-11-01; anchor ratio
# W(T0)/W(T0-365d)=30/30=1 -> anchor=1.0; tail 2022-02-10 ratio
# W(2022-02-10)/W(2021-02-10)->36/30(2021-02-08, tol 2d)=1.2,
# official_ffill(2021-02-10)=10.0 -> at lam=0.5: model=10*(1+.5*.2)=11.0,
# err=(11.0-10.4)/10.0*100=+6.0, cf=(10.0-10.4)/10.0*100=-4.0 (same numbers
# as the hand-computed fixture above; only the calendar year moved).
# Gradeable at EVERY lambda in LAMBDAS: at lam=0 the ratio term vanishes
# (model=official[ob], always positive); at lam=1 tail model=10*1.2=12>0.
#
# POISON 2022-05-01: anchored on its OWN later official print (2022-03-01,
# added so its tail window doesn't overlap CLEAN's 2022-02-10 tail date) —
# anchor ratio W(2022-02-27)/W(2021-02-27)=30/30=1 -> model=official[ob]=
# 10.0 regardless of lambda, so the anchor itself is unaffected by the
# poison below. Its tail (2022-05-10) is poisoned: wt=-5.0, wb=30.0 against
# official_ffill(2021-05-10)=10.0 ("2021-05-01"):
#   model(tail, lam) = 10.0 * (1 + lam*(-5/30 - 1)) = 10.0*(1 + lam*(-7/6))
#   lam=1.00: 10*(1-7/6)  = -1.667 <= 0 -> splice_year_ratio's sign guard
#             skips this date entirely -> grade_month has no tail date ->
#             POISON is ungraded for lam=1.0 ONLY.
#   lam=0.25: 10*(1-7/24) = +7.083 > 0  -> POISON grades fine.
#   lam=0.00: model reduces to official[ob]=10.0 (ratio term x0) -> always
#             grades, matching "λ=0's model is always positive whenever
#             coverage exists".
GRADE_ALL_OFFICIAL = {
    "2020-11-01": 10.0, "2021-02-01": 10.0, "2021-11-01": 10.0,
    "2022-02-01": 10.4,
    "2021-05-01": 10.0, "2022-03-01": 10.4, "2022-05-01": 10.4,
}
GRADE_ALL_W = {
    "2020-10-30": 30.0, "2021-02-08": 30.0, "2021-10-30": 30.0,
    "2022-02-10": 36.0,
    "2021-02-27": 30.0, "2022-02-27": 30.0,
    "2021-05-10": 30.0, "2022-05-10": -5.0,
}
GRADE_ALL_TARGETS = ["2022-02-01", "2022-05-01"]


def test_grade_all_excludes_month_ungradeable_by_any_lambda():
    per_lambda, common, dropped, mae, mx, cf_mae = bt.grade_all(
        GRADE_ALL_OFFICIAL, GRADE_ALL_W, GRADE_ALL_TARGETS, bt.LAMBDAS)

    # POISON grades individually at lam=0.25 but not at lam=1.0 (sign guard)
    assert "2022-05-01" in per_lambda[0.25]
    assert "2022-05-01" not in per_lambda[1.0]

    # excluded from the common intersection for EVERY lambda, not just
    # 1.0 — a fair comparison can't score the volatile month for some
    # candidates and not others.
    assert common == ["2022-02-01"]
    assert dropped == ["2022-05-01"]

    # carry-forward MAE computed over that same common set (CLEAN's
    # hand-verified cf = -4.0 -> |cf| = 4.0)
    assert cf_mae == pytest.approx(4.0)
    assert set(mae) == set(bt.LAMBDAS)  # every lambda scored over `common`
    assert mae[0.5] == pytest.approx(6.0)   # CLEAN's hand-verified err
    assert mx[0.5] == pytest.approx(6.0)
    assert per_lambda[0.5]["2022-02-01"] == pytest.approx((6.0, -4.0))


def test_grade_all_empty_when_no_common_months():
    per_lambda, common, dropped, mae, mx, cf_mae = bt.grade_all(
        {}, {}, [], bt.LAMBDAS)
    assert common == []
    assert dropped == []
    assert mae == {} and mx == {}
    assert cf_mae is None
