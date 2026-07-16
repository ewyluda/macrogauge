import csv
import io
import zipfile

import pytest

from pipeline.connectors import caiso


def _zip_bytes(rows, columns=("OPR_DT", "LMP_TYPE", "MW")):  # SPIKE-FINAL cols
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(columns)
    w.writerows(rows)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("prc_lmp.csv", buf.getvalue())
    return zbuf.getvalue()


def _hours(values, day="2026-07-14", lmp_type="LMP"):
    return [(day, lmp_type, v) for v in values]  # SPIKE-FINAL: OPR_DT carries trade date


class _R:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


def _get(content):
    return lambda url, timeout=None: _R(content)


def test_happy_path_daily_mean():
    rows = _hours([40.0] * 12 + [50.0] * 12) + _hours([999.0] * 24, lmp_type="MCC")
    obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                      trade_date="2026-07-14", http_get=_get(_zip_bytes(rows)))
    assert len(obs) == 1
    assert obs[0].value == pytest.approx(45.0)     # MCC rows excluded
    assert obs[0].obs_date == "2026-07-14"
    assert (obs[0].source, obs[0].route) == ("CAISO", "API")


def test_negative_daily_mean_accepted():
    obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                      trade_date="2026-07-14",
                      http_get=_get(_zip_bytes(_hours([-5.0] * 24))))
    assert obs[0].value == pytest.approx(-5.0)


def test_dst_row_counts_accepted():
    for n in (23, 25):
        obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                          trade_date="2026-03-08",
                          http_get=_get(_zip_bytes(_hours([30.0] * n, day="2026-03-08"))))
        assert obs[0].value == pytest.approx(30.0)


def test_bad_row_count_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                    trade_date="2026-07-14",
                    http_get=_get(_zip_bytes(_hours([30.0] * 5))))


def test_missing_column_is_structure_drift():
    bad = _zip_bytes(_hours([30.0] * 24), columns=("TIME", "KIND", "PRICE"))
    with pytest.raises(ValueError, match="structure drift"):
        caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                    trade_date="2026-07-14", http_get=_get(bad))


def test_empty_zip_is_structure_drift():
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w"):
        pass
    with pytest.raises(ValueError, match="structure drift"):
        caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                    trade_date="2026-07-14", http_get=_get(zbuf.getvalue()))


def test_stray_next_day_opr_dt_rows_excluded():
    # SPIKE-FINAL: T07:00 window can leak neighbor-day rows in PST months.
    # 24 clean LMP rows for the trade date + 3 stray rows tagged with the
    # next day's OPR_DT — the stray rows must be filtered out by OPR_DT,
    # not just averaged in blindly.
    rows = (_hours([40.0] * 12 + [50.0] * 12, day="2026-07-14")
            + _hours([999.0] * 3, day="2026-07-15"))
    obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                      trade_date="2026-07-14", http_get=_get(_zip_bytes(rows)))
    assert obs[0].value == pytest.approx(45.0)


def test_pst_window_simulation():
    # A T07:00-only end boundary closes an hour early in local time during
    # PST months and MISSES the target day's HE24 entirely — a silent
    # 23-hour mean indistinguishable from a genuine DST short day. The
    # widened window (T07:00 start .. T09:00 D+1 end) must pull in the full
    # 24 target-day hours plus both neighbor days, and the OPR_DT filter
    # must extract exactly the 24 target rows.
    rows = (_hours([99.0], day="2026-01-14")           # prior-day straggler
            + _hours([30.0] * 24, day="2026-01-15")    # full target day
            + _hours([999.0] * 9, day="2026-01-16"))   # next-day rows
    obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-01-16",
                      trade_date="2026-01-15", http_get=_get(_zip_bytes(rows)))
    assert len(obs) == 1
    assert obs[0].value == pytest.approx(30.0)
