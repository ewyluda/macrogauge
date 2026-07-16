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
