import pytest

from pipeline import derived

COMPS = {"a": "A", "b": "B"}
RI = {2024: {"a": 50.0, "b": 30.0, "other": 20.0},
      2025: {"a": 40.0, "b": 40.0, "other": 20.0}}


def _series(cpi, a, b):
    return {"CPIAUCNS": cpi, "A": a, "B": b}


def test_residual_solves_laspeyres_identity_and_chains_across_decembers():
    # Build CPI from known component relatives with a residual growing 1%/mo
    # in 2025 and 2%/mo in 2026, then check the residual is recovered exactly.
    dates = ["2024-12-01", "2025-06-01", "2025-12-01", "2026-03-01"]
    a = {"2024-12-01": 100, "2025-06-01": 102, "2025-12-01": 104, "2026-03-01": 105}
    b = {"2024-12-01": 200, "2025-06-01": 198, "2025-12-01": 210, "2026-03-01": 214}
    resid = {"2024-12-01": 1.0, "2025-06-01": 1.06, "2025-12-01": 1.12}
    cpi = {"2024-12-01": 300.0}
    for t in dates[1:3]:
        w = RI[2024]
        cpi[t] = 300.0 / 100 * (w["a"] * a[t] / 100 + w["b"] * b[t] / 200 + w["other"] * resid[t])
    # 2026 uses the Dec-2025 table and base
    w = RI[2025]
    cpi["2026-03-01"] = cpi["2025-12-01"] / 100 * (
        w["a"] * 105 / 104 + w["b"] * 214 / 210 + w["other"] * 1.02)
    out = derived.residual_index(_series(cpi, a, b), COMPS, RI)
    assert out["2024-12-01"] == 100.0
    assert out["2025-06-01"] == pytest.approx(106.0)
    assert out["2025-12-01"] == pytest.approx(112.0)
    assert out["2026-03-01"] == pytest.approx(112.0 * 1.02)


def test_missing_input_month_is_skipped_not_fatal():
    cpi = {"2024-12-01": 100.0, "2025-10-01": 103.0, "2025-11-01": 104.0}
    a = {"2024-12-01": 100.0, "2025-11-01": 104.0}  # no 2025-10 print
    b = {"2024-12-01": 100.0, "2025-10-01": 103.0, "2025-11-01": 104.0}
    out = derived.residual_index(_series(cpi, a, b), COMPS, RI)
    assert "2025-10-01" not in out and out["2025-11-01"] == pytest.approx(104.0)


def test_real_ri_table_has_residual_share():
    ri = derived.load_ri()
    assert set(range(2016, 2026)) <= set(ri)
    assert ri[2025]["other"] == pytest.approx(17.73)
