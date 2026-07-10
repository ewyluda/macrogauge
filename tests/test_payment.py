from pytest import approx

from pipeline.engine import payment


def test_payment_matches_hand_computed_case():
    """L=0.8*400000=320000, r=0.06/12=0.005, (1+r)^360=6.022575...,
    P = L*r*(1+r)^360/((1+r)^360-1) = 1918.56 (hand-derived; re-check it)."""
    zhvi = {"2026-01-01": 400000.0}
    rate = {"2026-02-01": 6.00}
    out = payment.payment_index(zhvi, rate)
    assert out == {"2026-02-01": approx(1918.56, abs=0.01)}


def test_payment_uses_latest_zhvi_at_or_before_each_rate_date():
    zhvi = {"2026-01-01": 400000.0, "2026-03-01": 410000.0}
    rate = {"2026-02-15": 6.00, "2026-03-02": 6.00}
    out = payment.payment_index(zhvi, rate)
    assert out["2026-02-15"] == approx(1918.56, abs=0.01)          # 400k home
    assert out["2026-03-02"] == approx(1918.56 * 410 / 400, abs=0.05)  # 410k home


def test_rate_dates_before_first_zhvi_are_skipped():
    zhvi = {"2026-01-01": 400000.0}
    rate = {"2025-12-31": 6.0, "2026-02-01": 6.0}
    out = payment.payment_index(zhvi, rate)
    assert "2025-12-31" not in out and "2026-02-01" in out


def test_zero_rate_falls_back_to_straight_line():
    zhvi = {"2026-01-01": 360000.0}
    rate = {"2026-02-01": 0.0}
    out = payment.payment_index(zhvi, rate)
    assert out["2026-02-01"] == approx(0.8 * 360000.0 / 360, abs=0.01)  # L/360
