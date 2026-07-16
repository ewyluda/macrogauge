"""Tests for pipeline.connectors.miso — MISO Indiana Hub daily DA ex-post LMP.

SPIKE-FINAL (docs/superpowers/specs/2026-07-15-power-spike-notes.md §2): the
committed fixture tests/fixtures/miso_da_expost.csv is real 2026-07-14 data;
INDIANA.HUB's LMP row (Value=="LMP") has expected daily mean 140.89 $/MWh.
"""
import pathlib

import pytest

from pipeline.connectors import miso

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "miso_da_expost.csv"

PREAMBLE = ("Day Ahead Market ExPost LMPs\n"
            "07/14/2026\n"
            "\n"
            ",,,All Hours-Ending are Eastern Standard Time (EST)\n")


class _R:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")


def _get(text, status_code=200):
    return lambda url, timeout=None: _R(text, status_code=status_code)


def _header(n_he=24):
    return "Node,Type,Value," + ",".join(f"HE {i}" for i in range(1, n_he + 1))


def _row(node, rowtype, values):
    return ",".join([node, "Hub", rowtype] + [str(v) for v in values])


def _csv(rows, n_he=24):
    return PREAMBLE + _header(n_he) + "\n" + "\n".join(rows) + "\n"


def test_happy_path_daily_mean_from_fixture():
    text = FIXTURE.read_text()
    obs = miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                      market_date="2026-07-14", http_get=_get(text))
    assert len(obs) == 1
    assert obs[0].value == pytest.approx(140.89)
    assert obs[0].obs_date == "2026-07-14"
    assert (obs[0].source, obs[0].route) == ("MISO", "CSV")


def test_lmp_row_selected_not_mcc_or_mlc():
    # Same hub, three row types (MCC/MLC rows are real in the fixture and
    # must never be averaged in) — only the Value=="LMP" row may win.
    rows = [
        _row("INDIANA.HUB", "LMP", [10.0] * 24),
        _row("INDIANA.HUB", "MCC", [999.0] * 24),
        _row("INDIANA.HUB", "MLC", [999.0] * 24),
    ]
    obs = miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                      market_date="2026-07-14", http_get=_get(_csv(rows)))
    assert obs[0].value == pytest.approx(10.0)


def test_missing_hub_row_is_structure_drift():
    rows = [_row("ILLINOIS.HUB", "LMP", [10.0] * 24)]
    with pytest.raises(ValueError, match="structure drift"):
        miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                   market_date="2026-07-14", http_get=_get(_csv(rows)))


def test_404_is_market_calendar_skip():
    obs = miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                      market_date="2026-07-17", http_get=_get("", status_code=404))
    assert obs == []


def test_malformed_he_cell_is_structure_drift():
    rows = [_row("INDIANA.HUB", "LMP", ["N/A"] + [10.0] * 23)]
    with pytest.raises(ValueError, match="structure drift"):
        miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                   market_date="2026-07-14", http_get=_get(_csv(rows)))


def test_negative_daily_mean_accepted():
    rows = [_row("INDIANA.HUB", "LMP", [-5.0] * 24)]
    obs = miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                      market_date="2026-07-14", http_get=_get(_csv(rows)))
    assert obs[0].value == pytest.approx(-5.0)


def test_he_count_out_of_range_is_structure_drift():
    rows = [_row("INDIANA.HUB", "LMP", [10.0] * 10)]
    with pytest.raises(ValueError, match="structure drift"):
        miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                   market_date="2026-07-14",
                   http_get=_get(_csv(rows, n_he=10)))
