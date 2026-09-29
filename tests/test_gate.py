from pipeline.engine import gate


def test_holds_just_arrived_spike():
    s = {"2026-07-01": 100.0, "2026-07-02": 106.0}  # +6% > 5%
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held["2026-07-02"] == 100.0
    assert flagged is True
    assert s["2026-07-02"] == 106.0  # input not mutated


def test_passes_small_move():
    s = {"2026-07-01": 100.0, "2026-07-02": 104.9}
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held == s and flagged is False


def test_old_last_obs_passes_through():
    # spike that persisted (not just-arrived) is real — stands
    s = {"2026-07-01": 100.0, "2026-07-02": 106.0}
    held, flagged = gate.apply_gate(s, arrived_today=False)
    assert held == s and flagged is False


def test_negative_spike_held():
    s = {"2026-07-01": 100.0, "2026-07-02": 94.0}  # -6%
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held["2026-07-02"] == 100.0 and flagged is True


def test_single_obs_noop():
    s = {"2026-07-01": 100.0}
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held == s and flagged is False


# like-month mode (year_ratio components, 2026-09-28)
SEASONAL = {"2025-09-01": 100.0, "2025-10-01": 108.0,   # last year's +8% turn
            "2026-09-01": 110.0}


def test_like_month_passes_a_seasonal_turn_the_raw_gate_would_hold():
    s = {**SEASONAL, "2026-10-01": 118.8}  # +8% again: same seasonal step
    assert gate.apply_gate(s, arrived_today=True)[1] is True             # raw: held
    held, flagged = gate.apply_gate(s, arrived_today=True, like_month=True)
    assert held == s and flagged is False


def test_like_month_holds_a_surprise_against_last_year():
    s = {**SEASONAL, "2026-10-01": 110.0}  # flat vs last year's +8%: -7.4% like-month
    held, flagged = gate.apply_gate(s, arrived_today=True, like_month=True)
    assert flagged is True and held["2026-10-01"] == 110.0
    assert gate.apply_gate(s, arrived_today=True)[1] is False  # raw: 0% step


def test_like_month_without_year_ago_falls_back_to_raw_move():
    s = {"2026-09-01": 100.0, "2026-10-01": 106.0}
    assert gate.apply_gate(s, arrived_today=True, like_month=True)[1] is True
