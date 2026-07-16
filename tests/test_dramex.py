from pathlib import Path

import pytest

from pipeline.connectors import dramex

FIXTURE = (Path(__file__).parent / "fixtures" / "dramex.html").read_text()


class _R:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _get(text):
    return lambda url, timeout=None: _R(text)


def test_happy_path_parses_session_averages():
    obs = dramex.fetch(["MLC 64Gb 8GBx8"],                     # SPIKE-FINAL label
                       vintage_date="2026-07-15", http_get=_get(FIXTURE))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "MLC 64Gb 8GBx8"                   # SPIKE-FINAL
    assert o.value == pytest.approx(31.1)                      # SPIKE-FINAL value
    assert (o.obs_date, o.vintage_date) == ("2026-07-15", "2026-07-15")
    assert (o.source, o.route) == ("DRAMEX", "SCRAPE")


def test_all_three_rows_parse():
    labels = ["MLC 64Gb 8GBx8", "DDR5 16Gb (2Gx8) 4800/5600",
              "DDR4 16Gb (2Gx8) 3200"]                         # SPIKE-FINAL labels
    obs = dramex.fetch(labels, vintage_date="2026-07-15", http_get=_get(FIXTURE))
    assert [o.series_code for o in obs] == labels
    assert all(dramex.PLAUSIBLE[0] <= o.value <= dramex.PLAUSIBLE[1] for o in obs)


def test_missing_row_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        dramex.fetch(["No Such Product 1Gb"], vintage_date="2026-07-15",
                     http_get=_get(FIXTURE))


@pytest.mark.parametrize("label,avg_cell", [
    # Row-leak shape demonstrated in the collectors spike: blank the target
    # row's session-average cell and an unbounded cell-scan bleeds past </tr>
    # into the eTT neighbor row, capturing its Daily High (26.00 / 12.00) —
    # inside PLAUSIBLE, so the garbage would be ingested silently.
    ("DDR5 16Gb (2Gx8) 4800/5600", "48.900"),   # leaks DDR5 eTT 26.00
    ("DDR4 16Gb (2Gx8) 3200", "79.375"),        # leaks DDR4 eTT 12.00
])
def test_short_row_must_not_leak_into_neighbor(label, avg_cell):
    html = FIXTURE.replace(f'">{avg_cell}<', '">-<')
    assert html != FIXTURE                      # mutation actually applied
    with pytest.raises(ValueError, match="structure drift"):
        dramex.fetch([label], vintage_date="2026-07-15", http_get=_get(html))


def test_implausible_value_is_structure_drift():
    html = ('<tr><td>MLC 64Gb 8GBx8</td>'
            + '<td class="tab_tr_gray">99999</td>' * 5 + "</tr>")
    with pytest.raises(ValueError, match="structure drift"):
        dramex.fetch(["MLC 64Gb 8GBx8"], vintage_date="2026-07-15",
                     http_get=_get(html))
