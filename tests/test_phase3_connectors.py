import pathlib

import pytest

from pipeline.connectors import cleveland, kalshi, street
from tests.test_fred import FakeResponse


class TextResponse:
    def __init__(self, text): self.text = text
    def raise_for_status(self): pass


def test_cleveland_parses_nearest_month_table():
    html = "<table><tr><td>July 2026</td><td>-0.00</td><td>0.23</td><td>0.13</td><td>0.28</td><td>07/08</td></tr></table>"
    rows = cleveland.fetch("2026-07-10", http_get=lambda *a, **k: TextResponse(html))
    assert [r.value for r in rows] == [-0.0, 0.23, 0.13, 0.28]


def test_kalshi_cdf_expected_value():
    # KXCPI markets are cumulative "Above X%" binaries: price = P(MoM > strike).
    # Bucket masses [0.1, 0.4, 0.4, 0.1] at values [0.05, 0.15, 0.25, 0.35] → 0.2.
    payload = {"markets": [
        {"floor_strike": 0.1, "last_price_dollars": "0.9"},
        {"floor_strike": 0.2, "last_price_dollars": "0.5"},
        {"floor_strike": 0.3, "last_price_dollars": "0.1"}]}
    rows = kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                        vintage_date="2026-07-10")
    assert rows[0].value == 0.2


def test_kalshi_uses_only_earliest_closing_event():
    # Open markets span several reference months; only the nearest print counts.
    payload = {"markets": [
        {"floor_strike": 0.1, "last_price_dollars": "0.9",
         "event_ticker": "KXCPI-26JUL", "close_time": "2026-08-11T00:00:00Z"},
        {"floor_strike": 0.2, "last_price_dollars": "0.5",
         "event_ticker": "KXCPI-26JUN", "close_time": "2026-07-14T00:00:00Z"},
        {"floor_strike": 0.3, "last_price_dollars": "0.5",
         "event_ticker": "KXCPI-26JUN", "close_time": "2026-07-14T00:00:00Z"}]}
    rows = kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                        vintage_date="2026-07-10")
    assert rows[0].value == 0.25


def test_kalshi_unpriced_markets_raise_cleanly():
    # last_price 0 means never traded, not P=0 — all-unpriced must not divide by zero.
    payload = {"markets": [{"floor_strike": 0.2, "last_price_dollars": 0},
                           {"floor_strike": 0.3, "last_price_dollars": None}]}
    with pytest.raises(ValueError, match="no priced"):
        kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                     vintage_date="2026-07-10")


def test_street_selects_monthly_cpi_consensus():
    payload = [{"event": "Consumer Price Index MoM", "date": "2026-07-14 08:30:00",
                "estimate": 0.3}]
    rows = street.fetch("key", "2026-07-10",
                        http_get=lambda *a, **k: FakeResponse(payload))
    assert rows[0].value == 0.3


def test_cleveland_parses_recorded_fixture():
    # Pinned to tests/fixtures/cleveland.html (recorded 2026-07-11) — the
    # drift-protection convention every scrape connector carries (spec 2a §3).
    html = (pathlib.Path(__file__).parent / "fixtures" / "cleveland.html").read_text()
    rows = cleveland.fetch("2026-07-11", http_get=lambda *a, **k: TextResponse(html))
    assert [(r.series_code, r.value) for r in rows] == [
        ("cleveland_cpi_mom", -0.0), ("cleveland_core_cpi_mom", 0.23),
        ("cleveland_pce_mom", 0.13), ("cleveland_core_pce_mom", 0.28)]
    assert all(r.obs_date == "2026-07-01" for r in rows)


def test_cleveland_implausible_value_raises_drift():
    # A YoY-magnitude number (the YoY table sits right below the MoM table
    # on the same page) means the anchor slid — degrade, don't ingest.
    html = ("<table><tr><td>July 2026</td><td>2.90</td><td>3.10</td>"
            "<td>2.60</td><td>2.80</td><td>07/10</td></tr></table>")
    with pytest.raises(ValueError, match="drift"):
        cleveland.fetch("2026-07-10", http_get=lambda *a, **k: TextResponse(html))
