"""NY Fed GSCPI connector (backlog #10c). Fixture: the live 2026-09-28
vintage-matrix CSV trimmed to its Date column + the last three vintage
columns (Jul-26, Aug-26, Sep-26); rows untouched."""
from pathlib import Path

import pytest

from pipeline.connectors import nyfed

FIXTURE = (Path(__file__).parent / "fixtures" / "nyfed_gscpi.csv").read_text()


class _R:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _get(text):
    return lambda url, timeout=None: _R(text)


def test_reads_the_latest_vintage_column_only():
    obs = nyfed.fetch(["GSCPI"], vintage_date="2026-09-28", http_get=_get(FIXTURE))
    by = {o.obs_date: o.value for o in obs}
    assert min(by) == "1997-09-01" and max(by) == "2026-08-01"
    assert by["2026-08-01"] == 1.06           # only the Sep-26 vintage covers Aug
    assert by["2026-07-01"] == 0.94           # Sep-26 revision (Aug-26 said 0.79)
    assert by["2021-12-01"] == 4.43           # record high region
    assert len(obs) == 348                    # 1997-09 .. 2026-08
    o = obs[0]
    assert (o.series_code, o.source, o.route, o.vintage_date) == \
        ("GSCPI", "NYFED", "CSV", "2026-09-28")


def test_header_drift_raises():
    with pytest.raises(ValueError, match="structure drift"):
        nyfed.fetch(["GSCPI"], http_get=_get("Month,Sep-26\n30-Sep-1997,1.0\n"))
    bad = FIXTURE.replace("Sep-26", "September 2026", 1)
    with pytest.raises(ValueError, match="structure drift"):
        nyfed.fetch(["GSCPI"], http_get=_get(bad))


def test_date_format_drift_raises():
    bad = FIXTURE.replace("30-Sep-1997", "1997-09-30", 1)
    with pytest.raises(ValueError, match="structure drift"):
        nyfed.fetch(["GSCPI"], http_get=_get(bad))


def test_implausible_value_raises():
    bad = FIXTURE.replace("31-Aug-2026,#N/A,#N/A,1.06", "31-Aug-2026,#N/A,#N/A,106")
    with pytest.raises(ValueError, match="structure drift"):
        nyfed.fetch(["GSCPI"], http_get=_get(bad))


def test_vintage_cannot_cover_its_own_month():
    bad = FIXTURE.replace(",,,", "30-Sep-2026,#N/A,#N/A,1.10")
    with pytest.raises(ValueError, match="structure drift"):
        nyfed.fetch(["GSCPI"], http_get=_get(bad))


def test_truncated_file_raises():
    head = "\n".join(FIXTURE.splitlines()[:50])
    with pytest.raises(ValueError, match="structure drift"):
        nyfed.fetch(["GSCPI"], http_get=_get(head))


MCT = (Path(__file__).parent / "fixtures" / "nyfed_mct.csv").read_text()


def _route(gscpi=FIXTURE, mct=MCT):
    return lambda url, timeout=None: _R(mct if "mct" in url else gscpi)


def test_mct_reads_the_point_estimate_not_the_band():
    # recorded 2026-09-29: July 2026 MCT 2.67, band (2.22, 3.09) — the NY Fed's
    # own note says "2.7 percent in July ... 68 percent probability band (2.2, 3.1)"
    obs = [o for o in nyfed.fetch(["MCT"], vintage_date="2026-09-29", http_get=_route())
           if o.series_code == "nyfed_mct"]
    assert obs[0].obs_date == "1960-01-01"
    assert (obs[-1].obs_date, obs[-1].value) == ("2026-07-01", 2.67)
    assert {(o.source, o.route) for o in obs} == {("NYFED", "CSV")}


def test_mct_header_drift_raises():
    bad = MCT.replace("column name,Date,MCT,MCT,MCT,MCT", "column name,Date,MCT,Low,High,MCT")
    with pytest.raises(ValueError, match="structure drift"):
        nyfed.fetch(["MCT"], http_get=_route(mct=bad))


def test_one_series_failing_is_partial_not_fatal():
    import warnings
    from pipeline.connectors.util import PartialFetchWarning
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        obs = nyfed.fetch(["GSCPI", "MCT"], vintage_date="2026-09-29",
                          http_get=_route(mct="<html>moved</html>"))
    assert obs and {o.series_code for o in obs} == {"GSCPI"}
    assert any(issubclass(w.category, PartialFetchWarning) for w in caught)


SCE_XLSX = (Path(__file__).parent / "fixtures" / "nyfed_sce.xlsx").read_bytes()


class _B:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


def test_sce_medians_stored_by_survey_month():
    # fixture: the live 2026-10-01 workbook trimmed to the title block, the
    # header row and the last 30 months of the two sheets read (values untouched)
    obs = nyfed.fetch(["SCE_1Y", "SCE_3Y", "SCE_5Y"], vintage_date="2026-10-01",
                      http_get=lambda url, timeout=None: _B(SCE_XLSX))
    last = {o.series_code: (o.obs_date, o.value) for o in obs}
    assert last["nyfed_sce_1y"] == ("2026-08-01", 3.5794)
    assert last["nyfed_sce_3y"] == ("2026-08-01", 3.1878)
    assert last["nyfed_sce_5y"] == ("2026-08-01", 3.0081)
    assert {(o.source, o.route, o.vintage_date) for o in obs} == {("NYFED", "XLSX", "2026-10-01")}


def test_sce_renamed_header_is_drift_and_does_not_take_gscpi_down():
    import io
    import warnings
    import openpyxl
    from pipeline.connectors.util import PartialFetchWarning
    wb = openpyxl.load_workbook(io.BytesIO(SCE_XLSX))
    ws = wb["Inflation expectations"]
    for row in ws.iter_rows():
        for c in row:
            if c.value == "Median one-year ahead expected inflation rate":
                c.value = "Median 1y expectation"
    buf = io.BytesIO(); wb.save(buf)

    def get(url, timeout=None):
        return _B(buf.getvalue()) if url.endswith(".xlsx") else _R(FIXTURE)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        obs = nyfed.fetch(["GSCPI", "SCE_1Y"], vintage_date="2026-10-01", http_get=get)
    assert {o.series_code for o in obs} == {"GSCPI"}
    assert any(issubclass(w.category, PartialFetchWarning) and "structure drift" in str(w.message)
               for w in caught)
