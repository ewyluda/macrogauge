import io

import openpyxl
import pytest

from pipeline.connectors import census


def _xlsx(sheet="Private SA",
          header=("Date", "Total", "Data center"),
          rows=(("May-26p", 1668966, 61000), ("Apr-26r", 1650000, 60000),
                ("Jan-14", 900000, 1500)),
          footer=(("",), ("The Census Bureau has reviewed this data product.",))):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(["Value of Private Construction Put in Place"])
    ws.append(["(Millions of dollars)"])
    ws.append([])
    ws.append(list(header))
    for r in rows:
        ws.append(list(r))
    for r in footer:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class _BytesResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


def _get(content_by_file, calls=None):
    def http_get(url, timeout=None):
        if calls is not None:
            calls.append(url)
        fname = url.rsplit("/", 1)[1]
        return _BytesResponse(content_by_file[fname])
    return http_get


def test_happy_path_both_files_and_suffix_stripping():
    http = _get({"privsatime.xlsx": _xlsx("Private SA"),
                 "privtime.xlsx": _xlsx("Private NSA",
                                        rows=(("May-26p", 144936, 5059),
                                              ("Jan-14", 75000, 124)))})
    obs = census.fetch(["privsatime.xlsx:Data center", "privtime.xlsx:Data center"],
                       vintage_date="2026-07-15", http_get=http)
    saar = {o.obs_date: o.value for o in obs
            if o.series_code == "privsatime.xlsx:Data center"}
    nsa = {o.obs_date: o.value for o in obs
           if o.series_code == "privtime.xlsx:Data center"}
    assert saar == {"2026-05-01": 61000.0, "2026-04-01": 60000.0, "2014-01-01": 1500.0}
    assert nsa == {"2026-05-01": 5059.0, "2014-01-01": 124.0}
    assert {o.source for o in obs} == {"CENSUS"}
    assert {o.route for o in obs} == {"XLSX"}
    assert {o.vintage_date for o in obs} == {"2026-07-15"}


def test_one_get_per_distinct_file():
    calls = []
    http = _get({"privsatime.xlsx": _xlsx("Private SA",
                                          header=("Date", "Office", "Data center"),
                                          rows=(("May-26p", 107558, 61000),))},
                calls)
    census.fetch(["privsatime.xlsx:Data center", "privsatime.xlsx:Office"],
                 vintage_date="2026-07-15", http_get=http)
    assert len(calls) == 1


def test_blank_target_cells_skipped():
    http = _get({"privsatime.xlsx": _xlsx(rows=(("May-26p", 1668966, 61000),
                                                ("Dec-13", 890000, None)))})
    obs = census.fetch(["privsatime.xlsx:Data center"],
                       vintage_date="2026-07-15", http_get=http)
    assert [o.obs_date for o in obs] == ["2026-05-01"]


@pytest.mark.parametrize("kwargs,match", [
    ({"sheet": "Sheet1"}, "structure drift"),
    ({"header": ("Month", "Total", "Data center")}, "structure drift"),
    ({"header": ("Date", "Total", "Office")}, "structure drift"),
    ({"rows": (("May-26p", 1668966, 9_999_999),)}, "structure drift"),
    ({"rows": ()}, "structure drift"),
])
def test_drift_checks_raise(kwargs, match):
    http = _get({"privsatime.xlsx": _xlsx(**kwargs)})
    with pytest.raises(ValueError, match=match):
        census.fetch(["privsatime.xlsx:Data center"],
                     vintage_date="2026-07-15", http_get=http)
