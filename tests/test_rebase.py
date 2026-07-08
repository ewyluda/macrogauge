import pytest

from pipeline.engine import rebase


def test_monthly_anchor():
    s = {"2017-12-01": 90.0, "2018-01-01": 200.0, "2018-02-01": 210.0}
    r = rebase.rebase(s)
    assert r["2018-01-01"] == pytest.approx(100.0)
    assert r["2018-02-01"] == pytest.approx(105.0)
    assert r["2017-12-01"] == pytest.approx(45.0)  # pre-base history kept


def test_weekly_mean_anchor():
    s = {"2018-01-01": 3.0, "2018-01-08": 3.2, "2018-01-15": 3.4,
         "2018-02-05": 4.8}
    r = rebase.rebase(s)
    # anchor = mean(3.0, 3.2, 3.4) = 3.2
    assert r["2018-01-08"] == pytest.approx(100.0)
    assert r["2018-02-05"] == pytest.approx(150.0)


def test_late_start_falls_back_to_first_month():
    s = {"2025-04-01": 50.0, "2025-05-01": 55.0}
    r = rebase.rebase(s)
    assert r["2025-04-01"] == pytest.approx(100.0)
    assert r["2025-05-01"] == pytest.approx(110.0)


def test_empty_series_raises():
    with pytest.raises(ValueError):
        rebase.rebase({})
