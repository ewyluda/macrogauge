import pytest

from pipeline.models import Observation
from pipeline.publish import real_wages
from pipeline.store import vintage

WGT, AHE = real_wages.WGT, real_wages.AHE


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="FRED", route="API")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def _gauge(yoy=1.7, as_of="2026-07-09"):
    return {"variants": {"gauge": {"yoy": {as_of: yoy}, "as_of": as_of}}}


def test_build_kpis_and_series(tmp_path):
    conn = _store_with(tmp_path, {
        WGT: {"2025-05-01": 4.0, "2026-04-01": 3.4, "2026-05-01": 3.5},
        AHE: {"2025-05-01": 30.00, "2025-06-01": 31.00, "2026-05-01": 31.50,
              "2026-06-01": 32.55}})
    p = real_wages.build(conn, _gauge(yoy=1.7))
    assert p["kpis"]["wage_growth_pct"] == 3.5
    assert p["kpis"]["wage_as_of"] == "2026-05-01"
    # hand-computed: (1.035 / 1.017 - 1) * 100 = 1.7699... -> 1.77
    assert p["kpis"]["real_wage_growth_pct"] == 1.77
    s = p["series"]
    assert s["months"] == ["2025-05-01", "2025-06-01", "2026-04-01",
                           "2026-05-01", "2026-06-01"]
    # WGT passes through; None where WGT has no obs that month
    assert s["atlanta_wgt_yoy_pct"] == [4.0, None, 3.4, 3.5, None]
    # AHE YoY hand-computed: 31.50/30.00 = +5.0, 32.55/31.00 = +5.0;
    # None where the 12-mo base is missing
    assert s["ahe_yoy_pct"] == [None, None, None, 5.0, 5.0]


def test_publish_start_filter(tmp_path):
    conn = _store_with(tmp_path, {WGT: {"2017-06-01": 3.0, "2018-02-01": 3.1}})
    p = real_wages.build(conn, _gauge())
    assert p["series"]["months"] == ["2018-02-01"]


def test_empty_store_publishes_nulls_never_raises(tmp_path):
    conn = _store_with(tmp_path, {})
    p = real_wages.build(conn, _gauge())
    assert p["kpis"] == {"wage_growth_pct": None, "wage_as_of": None,
                         "real_wage_growth_pct": None}
    assert p["series"] == {"months": [], "atlanta_wgt_yoy_pct": [],
                           "ahe_yoy_pct": []}
