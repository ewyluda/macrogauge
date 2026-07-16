import pathlib

import pytest

from pipeline.connectors import cleveland, kalshi
from tests.test_fred import FakeResponse

MOM_HEADING = "Inflation, month-over-month percent change"
YOY_HEADING = "Inflation, year-over-year percent change"


class TextResponse:
    def __init__(self, text): self.text = text
    def raise_for_status(self): pass


def test_cleveland_parses_every_nowcast_month():
    # The page carries the next month AND the current reference month until
    # its print lands — both must publish, or the benchmark drops out of the
    # ensemble in the week before every release.
    html = (f"<h2>{MOM_HEADING}</h2><table>"
            "<tr><td>July 2026</td><td>-0.00</td><td>0.23</td><td>0.13</td><td>0.28</td><td>07/13</td></tr>"
            "<tr><td>June 2026</td><td>-0.06</td><td>0.23</td><td>0.10</td><td>0.28</td><td>07/13</td></tr>"
            "</table>")
    rows = cleveland.fetch("2026-07-13", http_get=lambda *a, **k: TextResponse(html))
    assert [(r.series_code, r.obs_date, r.value) for r in rows] == [
        ("cleveland_cpi_mom", "2026-07-01", -0.0),
        ("cleveland_core_cpi_mom", "2026-07-01", 0.23),
        ("cleveland_pce_mom", "2026-07-01", 0.13),
        ("cleveland_core_pce_mom", "2026-07-01", 0.28),
        ("cleveland_cpi_mom", "2026-06-01", -0.06),
        ("cleveland_core_cpi_mom", "2026-06-01", 0.23),
        ("cleveland_pce_mom", "2026-06-01", 0.10),
        ("cleveland_core_pce_mom", "2026-06-01", 0.28)]


def test_cleveland_excludes_yoy_table_rows():
    # The YoY table sits below the MoM table and matches the same row shape
    # on the live page — its ~2-4 magnitude values must be sliced away, not
    # ingested and not tripped over as "implausible".
    html = (f"<h2>{MOM_HEADING}</h2><table>"
            "<tr><td>July 2026</td><td>-0.00</td><td>0.23</td><td>0.13</td><td>0.28</td><td>07/13</td></tr>"
            f"</table><h2>{YOY_HEADING}</h2><table>"
            "<tr><td>July 2026</td><td>3.71</td><td>2.81</td><td>3.84</td><td>3.47</td><td>07/13</td></tr>"
            "</table>")
    rows = cleveland.fetch("2026-07-13", http_get=lambda *a, **k: TextResponse(html))
    assert len(rows) == 4
    assert all(r.obs_date == "2026-07-01" for r in rows)
    assert [r.value for r in rows] == [-0.0, 0.23, 0.13, 0.28]


def test_cleveland_missing_mom_heading_raises_drift():
    html = "<table><tr><td>July 2026</td><td>-0.00</td><td>0.23</td><td>0.13</td><td>0.28</td><td>07/08</td></tr></table>"
    with pytest.raises(ValueError, match="drift"):
        cleveland.fetch("2026-07-10", http_get=lambda *a, **k: TextResponse(html))


def test_kalshi_cdf_expected_value():
    # KXCPI markets are cumulative "Above X%" binaries: price = P(MoM > strike).
    # Bucket masses [0.1, 0.4, 0.4, 0.1] at values [0.05, 0.15, 0.25, 0.35] → 0.2.
    payload = {"markets": [
        {"floor_strike": 0.1, "last_price_dollars": "0.9",
         "event_ticker": "KXCPI-26JUL", "close_time": "2026-08-11T00:00:00Z"},
        {"floor_strike": 0.2, "last_price_dollars": "0.5",
         "event_ticker": "KXCPI-26JUL", "close_time": "2026-08-11T00:00:00Z"},
        {"floor_strike": 0.3, "last_price_dollars": "0.1",
         "event_ticker": "KXCPI-26JUL", "close_time": "2026-08-11T00:00:00Z"}]}
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
    payload = {"markets": [{"floor_strike": 0.2, "last_price_dollars": 0,
                            "event_ticker": "KXCPI-26JUL",
                            "close_time": "2026-08-11T00:00:00Z"},
                           {"floor_strike": 0.3, "last_price_dollars": None,
                            "event_ticker": "KXCPI-26JUL",
                            "close_time": "2026-08-11T00:00:00Z"}]}
    with pytest.raises(ValueError, match="no priced"):
        kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                     vintage_date="2026-07-10")


def test_kalshi_obs_date_from_event_ticker():
    payload = {"markets": [
        {"floor_strike": 0.2, "last_price_dollars": "0.5",
         "event_ticker": "KXCPI-26JUN", "close_time": "2026-07-14T00:00:00Z"}]}
    rows = kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                        vintage_date="2026-07-10")
    assert rows[0].obs_date == "2026-06-01"
    assert rows[0].vintage_date == "2026-07-10"


def test_kalshi_obs_date_falls_back_to_close_time():
    # unparsable ticker: close is release morning -> reference = prior month
    payload = {"markets": [
        {"floor_strike": 0.2, "last_price_dollars": "0.5",
         "event_ticker": "KXCPI-WEIRD", "close_time": "2026-07-14T00:00:00Z"}]}
    rows = kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                        vintage_date="2026-07-10")
    assert rows[0].obs_date == "2026-06-01"


def test_cleveland_parses_recorded_fixture():
    # Pinned to tests/fixtures/cleveland.html (recorded 2026-07-13, full page
    # including the YoY table) — the drift-protection convention every scrape
    # connector carries (spec 2a §3).
    html = (pathlib.Path(__file__).parent / "fixtures" / "cleveland.html").read_text()
    rows = cleveland.fetch("2026-07-13", http_get=lambda *a, **k: TextResponse(html))
    assert [(r.series_code, r.obs_date, r.value) for r in rows] == [
        ("cleveland_cpi_mom", "2026-07-01", -0.0),
        ("cleveland_core_cpi_mom", "2026-07-01", 0.23),
        ("cleveland_pce_mom", "2026-07-01", 0.13),
        ("cleveland_core_pce_mom", "2026-07-01", 0.28),
        ("cleveland_cpi_mom", "2026-06-01", -0.06),
        ("cleveland_core_cpi_mom", "2026-06-01", 0.23),
        ("cleveland_pce_mom", "2026-06-01", 0.10),
        ("cleveland_core_pce_mom", "2026-06-01", 0.28)]


def test_cleveland_implausible_value_raises_drift():
    # A YoY-magnitude number inside the MoM table means the page structure
    # changed under us — degrade, don't ingest.
    html = (f"<h2>{MOM_HEADING}</h2><table>"
            "<tr><td>July 2026</td><td>2.90</td><td>3.10</td>"
            "<td>2.60</td><td>2.80</td><td>07/10</td></tr></table>")
    with pytest.raises(ValueError, match="drift"):
        cleveland.fetch("2026-07-10", http_get=lambda *a, **k: TextResponse(html))


def test_kalshi_dc_ladder_expected_count():
    # hand-computed: strikes 1000/2000, probs 0.9/0.4 -> gaps [1000], tail 500
    # values [500, 1500, 2500]; masses [0.1, 0.5, 0.4]
    # E = 50 + 750 + 1000 = 1800.0
    payload = {"markets": [
        {"floor_strike": 1000, "last_price_dollars": "0.9"},
        {"floor_strike": 2000, "last_price_dollars": "0.4"}]}
    rows = kalshi.fetch_dc(["KXUSADATACENTERS"], vintage_date="2026-07-16",
                           http_get=lambda *a, **k: FakeResponse(payload))
    assert len(rows) == 1
    assert rows[0].value == pytest.approx(1800.0)
    assert rows[0].series_code == "KXUSADATACENTERS"
    assert rows[0].obs_date == "2026-07-16"        # fetch date, standing question
    assert (rows[0].source, rows[0].route) == ("KALSHI_DC", "API")


def test_kalshi_dc_binary_probability():
    payload = {"markets": [{"last_price_dollars": "0.61"}]}
    rows = kalshi.fetch_dc(["KXDATACENTER"], vintage_date="2026-07-16",
                           http_get=lambda *a, **k: FakeResponse(payload))
    assert rows[0].value == pytest.approx(0.61)


def test_kalshi_dc_single_rung_ladder_is_skip_not_binary():
    # A ladder-style book (market carries floor_strike) with exactly ONE
    # priced rung must SKIP, not fall into the binary branch and publish a
    # 0-1 probability as a count (confirmed live for 3 weeks in June 2026;
    # recurs at every annual event rollover).
    payload = {"markets": [{"floor_strike": 4800, "last_price_dollars": "0.85"}]}
    rows = kalshi.fetch_dc(["KXUSADATACENTERS"], vintage_date="2026-07-16",
                           http_get=lambda *a, **k: FakeResponse(payload))
    assert rows == []


def test_kalshi_dc_thin_book_is_skip_not_error():
    # unpriced/empty books are EXPECTED on speculative markets: skip, never
    # raise (contrast the CPI fetch, whose books are always live)
    empty = {"markets": []}
    unpriced = {"markets": [{"floor_strike": 1000, "last_price_dollars": "0"}]}
    for payload in (empty, unpriced):
        rows = kalshi.fetch_dc(["KXUSADATACENTERS"], vintage_date="2026-07-16",
                               http_get=lambda *a, **k: FakeResponse(payload))
        assert rows == []


def test_kalshi_dc_one_thin_ticker_does_not_drop_the_other():
    def get(url, params=None, timeout=None):
        if params["series_ticker"] == "KXUSADATACENTERS":
            return FakeResponse({"markets": []})
        return FakeResponse({"markets": [{"last_price_dollars": "0.61"}]})
    rows = kalshi.fetch_dc(["KXUSADATACENTERS", "KXDATACENTER"],
                           vintage_date="2026-07-16", http_get=get)
    assert [r.series_code for r in rows] == ["KXDATACENTER"]


def test_kalshi_dc_implausible_count_is_structure_drift():
    payload = {"markets": [
        {"floor_strike": 900000, "last_price_dollars": "0.9"},
        {"floor_strike": 990000, "last_price_dollars": "0.4"}]}
    with pytest.raises(ValueError, match="structure drift"):
        kalshi.fetch_dc(["KXUSADATACENTERS"], vintage_date="2026-07-16",
                        http_get=lambda *a, **k: FakeResponse(payload))


def test_kalshi_dc_fixture_shapes_parse():
    # the spike-trimmed live payloads must flow through the real code path
    import json as _json
    import pathlib
    fixtures = pathlib.Path(__file__).parent / "fixtures"
    for ticker, name in (("KXUSADATACENTERS", "kalshi_dc_count.json"),
                         ("KXDATACENTER", "kalshi_dc_nuclear.json")):
        payload = _json.loads((fixtures / name).read_text())
        rows = kalshi.fetch_dc([ticker], vintage_date="2026-07-16",
                               http_get=lambda *a, **k: FakeResponse(payload))
        assert len(rows) <= 1   # priced -> one obs; thin fixture -> zero
