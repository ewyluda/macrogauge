from pipeline.connectors import cleveland, kalshi, street
from tests.test_fred import FakeResponse


class TextResponse:
    def __init__(self, text): self.text = text
    def raise_for_status(self): pass


def test_cleveland_parses_nearest_month_table():
    html = "<table><tr><td>July 2026</td><td>-0.00</td><td>0.23</td><td>0.13</td><td>0.28</td><td>07/08</td></tr></table>"
    rows = cleveland.fetch("2026-07-10", http_get=lambda *a, **k: TextResponse(html))
    assert [r.value for r in rows] == [-0.0, 0.23, 0.13, 0.28]


def test_kalshi_probability_weighted_strike():
    payload = {"markets": [
        {"floor_strike": 0.2, "last_price_dollars": "0.25"},
        {"floor_strike": 0.3, "last_price_dollars": "0.75"}]}
    rows = kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                        vintage_date="2026-07-10")
    assert rows[0].value == 0.275


def test_street_selects_monthly_cpi_consensus():
    payload = [{"event": "Consumer Price Index MoM", "date": "2026-07-14 08:30:00",
                "estimate": 0.3}]
    rows = street.fetch("key", "2026-07-10",
                        http_get=lambda *a, **k: FakeResponse(payload))
    assert rows[0].value == 0.3
