from pipeline.basket import Component
from pipeline.engine import variants


def _monthly(start_year, values):
    out = {}
    y, m = start_year, 1
    for v in values:
        out[f"{y:04d}-{m:02d}-01"] = v
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def _comp(method):
    return Component(code="electricity", label="Electricity", weight=0.025,
                     official_series="CUUR0000SEHF01", live_blend={"eia": 1.0},
                     live_variants=("gauge",), live_method=method)


def test_year_ratio_keeps_official_where_it_exists_when_live_lags():
    # BLS runs through 2019-08; the live leg (EIA) only through 2019-07 and
    # with a very different, seasonal level path. Official must win.
    official = _monthly(2018, [100 + i for i in range(20)])        # 2018-01..2019-08
    live = _monthly(2018, [50 + 30 * (i % 12 in (6, 7)) for i in range(19)])  # ..2019-07
    idx, mode, _ = variants.build_component(_comp("year_ratio"), "gauge", official, {"eia": live})
    assert mode == "bls_cf"
    ratio = idx["2019-08-01"] / idx["2018-08-01"]
    assert abs(ratio - official["2019-08-01"] / official["2018-08-01"]) < 1e-9


def test_year_ratio_extends_past_last_print_with_like_month_ratio():
    official = _monthly(2018, [100 + i for i in range(19)])        # ..2019-07
    live = _monthly(2018, [50 + i for i in range(20)])             # ..2019-08
    idx, mode, _ = variants.build_component(_comp("year_ratio"), "gauge", official, {"eia": live})
    assert mode == "live" and "2019-08-01" in idx


def test_level_method_still_replaces_official_from_live_start():
    official = _monthly(2018, [100 + i for i in range(20)])
    live = _monthly(2019, [10, 20])
    idx, mode, _ = variants.build_component(_comp("level"), "gauge", official, {"eia": live})
    assert mode == "live"
    assert idx["2019-02-01"] / idx["2019-01-01"] == 2.0
