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
