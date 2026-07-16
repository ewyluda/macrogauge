"""Tests for pipeline.connectors.ice — EIA ICE workbook, panel-only hub prices.

SPIKE-FINAL (docs/superpowers/specs/2026-07-15-power-spike-notes.md §3): 11
populated columns incl. `Delivery \nend date` (literal embedded newline in
its header cell — included in the fixture header to prove normalization
covers columns beyond the two this connector actually reads).
"""
import io
from datetime import datetime

import openpyxl
import pytest

from pipeline.connectors import ice

PJM = "PJM WH Real Time Peak"
NEIGHBOR = "Indiana Hub RT Peak"

HEADER = ["Price hub", "Trade date", "Delivery start date", "Delivery \nend date",
          "High price $/MWh", "Low price $/MWh", "Wtd avg price $/MWh", "Change",
          "Daily volume MWh", "Number of trades", "Number of counterparties"]


def _row(hub, trade_date, wtd_avg):
    d = datetime.strptime(trade_date, "%Y-%m-%d")
    return [hub, d, d, d, wtd_avg + 5, wtd_avg - 5, wtd_avg, 0.5, 12345, 42, 7]


def _xlsx(sheet="2026", header=HEADER, rows=None, footer=(("Source: ICE",),)):
    if rows is None:
        rows = [
            _row(PJM, "2026-07-06", 70.11),
            _row(PJM, "2026-07-07", 72.38),
            _row(NEIGHBOR, "2026-07-07", 85.00),
        ]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
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


def _get(content):
    return lambda url, timeout=None: _BytesResponse(content)


def test_happy_path_multi_date_neighbor_hub_excluded():
    obs = ice.fetch([PJM], vintage_date="2026-07-15", http_get=_get(_xlsx()), year=2026)
    assert {o.obs_date for o in obs} == {"2026-07-06", "2026-07-07"}
    assert {o.value for o in obs} == {70.11, 72.38}
    assert {o.series_code for o in obs} == {PJM}   # neighbor hub's row excluded
    assert {o.source for o in obs} == {"ICE"}
    assert {o.route for o in obs} == {"XLSX"}
    assert {o.vintage_date for o in obs} == {"2026-07-15"}


def test_negative_wtd_avg_accepted():
    rows = [_row(PJM, "2026-03-08", -12.5)]
    obs = ice.fetch([PJM], vintage_date="2026-07-15",
                    http_get=_get(_xlsx(rows=rows)), year=2026)
    assert obs[0].value == -12.5


def test_missing_hub_raises_drift():
    with pytest.raises(ValueError, match="structure drift"):
        ice.fetch(["Mid C Peak"], vintage_date="2026-07-15",
                  http_get=_get(_xlsx()), year=2026)


@pytest.mark.parametrize("header,match", [
    # Branch 1: Missing "Price hub" anchor row (cannot locate header by name in first 8 rows)
    (["Trade date", "High price $/MWh", "Low price $/MWh", "Wtd avg price $/MWh"],
     "structure drift"),
    # Branch 2: Header present but "Trade date" column missing
    (["Price hub", "High price $/MWh", "Low price $/MWh", "Wtd avg price $/MWh"],
     "structure drift"),
    # Branch 3: Header present but "Wtd avg price $/MWh" column missing
    (["Price hub", "Trade date", "High price $/MWh", "Low price $/MWh"],
     "structure drift"),
])
def test_header_drift_raises(header, match):
    """Test all three header-shape drift branches via parametrize (census pattern)."""
    rows = [[PJM, datetime(2026, 7, 7), 90.0, 80.0, 85.0, 70.0] if len(header) >= 6
            else [PJM, datetime(2026, 7, 7), 90.0]]
    content = _xlsx(header=header, rows=rows)
    with pytest.raises(ValueError, match=match):
        ice.fetch([PJM], vintage_date="2026-07-15", http_get=_get(content), year=2026)


def test_out_of_range_value_raises_drift():
    rows = [_row(PJM, "2026-07-07", 9999.0)]
    with pytest.raises(ValueError, match="structure drift"):
        ice.fetch([PJM], vintage_date="2026-07-15",
                  http_get=_get(_xlsx(rows=rows)), year=2026)


def test_blank_price_cell_skipped():
    good = _row(PJM, "2026-07-06", 70.11)
    blank = _row(PJM, "2026-07-07", 72.38)
    blank[6] = None  # Wtd avg price $/MWh column
    obs = ice.fetch([PJM], vintage_date="2026-07-15",
                    http_get=_get(_xlsx(rows=[good, blank])), year=2026)
    assert [o.obs_date for o in obs] == ["2026-07-06"]
