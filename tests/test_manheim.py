import pathlib
import re

import pytest

from pipeline.connectors import manheim

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
# Recorded from the access spike (2026-07-09) against the live page: the
# report on-page right now is the "Mid-December 2025" update, value 206.0.
EXPECTED_MONTH = "2025-12-01"
EXPECTED_VALUE = 206.0
# The fixture's stat-callout decoy is deliberately a *different* in-range
# value (see tests/fixtures/manheim.html) so a regex that grabs the wrong
# ("... Trends" heading-unanchored) occurrence is caught here instead of
# passing by coincidence.
DECOY_VALUE = 199.9


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _fake_get_for(text):
    def fake_get(url, timeout=None):
        return FakeResponse(text)
    return fake_get


def test_fetch_extracts_latest_index_and_month():
    html = (FIXTURES / "manheim.html").read_text()
    obs = manheim.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(html))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "manheim_uvvi_m"
    assert o.source == "MANHEIM" and o.route == "SCRAPE"
    assert o.obs_date == EXPECTED_MONTH
    assert o.vintage_date == "2026-07-10"
    # Anchored on the "... Trends" heading, not the stat-callout decoy:
    # asserting the exact value (and that it is NOT the decoy) proves the
    # heading anchor -- not first-match luck -- is load-bearing.
    assert o.value == pytest.approx(EXPECTED_VALUE)
    assert o.value != pytest.approx(DECOY_VALUE)


def test_fetch_raises_on_structure_drift():
    try:
        manheim.fetch(vintage_date="2026-07-10",
                      http_get=_fake_get_for("<html><body>redesigned</body></html>"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "UVVI" in str(e)


def test_fetch_raises_on_implausible_value():
    html = (FIXTURES / "manheim.html").read_text()
    drifted = html.replace(_index_value(html), "999.9")
    try:
        manheim.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "implausible" in str(e)


def _index_value(html):
    return re.search(r"\d{3}\.\d", html).group(0)
