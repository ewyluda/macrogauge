import pytest

from pipeline import dates


def test_month_first():
    assert dates.month_first("2026-05") == "2026-05-01"
    assert dates.month_first("2026-05-31") == "2026-05-01"


def test_months_back_wraps_years():
    assert dates.months_back("2026-01-01", 1) == "2025-12-01"
    assert dates.months_back("2026-03-01", 12) == "2025-03-01"
    assert dates.months_back("2026-01-01", -1) == "2026-02-01"


def test_prior_and_next_month():
    assert dates.prior_month("2026-01-01") == "2025-12-01"
    assert dates.next_month("2025-12-01") == "2026-01-01"


def test_monthly_changes_skips_non_adjacent_months():
    # 2025-10 never published: 2025-11 vs 2025-09 is a 2-month change, not MoM
    levels = {"2025-08-01": 100.0, "2025-09-01": 100.5, "2025-11-01": 101.5,
              "2025-12-01": 101.7}
    out = dates.monthly_changes(levels)
    assert out["2025-09-01"] == pytest.approx(0.5)
    assert "2025-11-01" not in out
    assert out["2025-12-01"] == pytest.approx((101.7 / 101.5 - 1) * 100)
