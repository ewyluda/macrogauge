"""Kalshi public market-data connector for CPI threshold probabilities."""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.dates import month_first, prior_month
from pipeline.models import Observation

URL = "https://external-api.kalshi.com/trade-api/v2/markets"

MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
          "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
TICKER_RE = re.compile(r"-(\d{2})([A-Z]{3})$")


def _reference_month(event_ticker: str, close_time: str | None) -> str:
    """KXCPI-26JUN names the June data month. Fallback: markets close on
    release morning, and a CPI release covers the prior calendar month."""
    m = TICKER_RE.search(event_ticker or "")
    if m and m[2] in MONTHS:
        return f"20{m[1]}-{MONTHS[m[2]]:02d}-01"
    if close_time:
        return prior_month(month_first(close_time[:10]))
    raise ValueError("cannot derive Kalshi reference month "
                     f"(ticker={event_ticker!r}, no close_time)")


def _expected_from_ladder(points: list[tuple[float, float]]) -> float:
    """Expected value from cumulative "Above X" binaries: prices approximate
    the survival curve P(value > strike); bucket masses are adjacent-price
    differences valued at bracket midpoints, tails extending half a typical
    bracket past each edge."""
    strikes = [s for s, _ in points]
    probs = [p for _, p in points]
    gaps = sorted(b - a for a, b in zip(strikes, strikes[1:]))
    tail = (gaps[len(gaps) // 2] if gaps else 0.1) / 2
    values = ([strikes[0] - tail]
              + [(a + b) / 2 for a, b in zip(strikes, strikes[1:])]
              + [strikes[-1] + tail])
    masses = ([1 - probs[0]]
              + [a - b for a, b in zip(probs, probs[1:])]
              + [probs[-1]])
    return sum(v * m for v, m in zip(values, masses))


def fetch(series_ticker: str = "KXCPI", vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    response = http_get(URL, params={"series_ticker": series_ticker,
                                     "status": "open", "limit": 100}, timeout=30)
    response.raise_for_status()
    markets = []
    for market in response.json().get("markets", []):
        strike = market.get("floor_strike")
        price = market.get("last_price_dollars")
        # last_price 0 means never traded, not P = 0.
        if strike is None or price in (None, "") or float(price) <= 0:
            continue
        markets.append(market)
    if not markets:
        raise ValueError("no priced Kalshi CPI markets")
    # Open markets span several reference months; keep only the print closing next.
    events: dict[str, list[dict]] = {}
    for market in markets:
        events.setdefault(market.get("event_ticker", ""), []).append(market)
    ticker, nearest = min(
        events.items(),
        key=lambda kv: min(m.get("close_time") or "9999" for m in kv[1]))
    points = sorted((float(m["floor_strike"]),
                     min(float(m["last_price_dollars"]), 1.0)) for m in nearest)
    expected = round(_expected_from_ladder(points), 6)
    close = min((m.get("close_time") for m in nearest if m.get("close_time")),
                default=None)
    obs_date = _reference_month(ticker, close)
    return [Observation("kalshi_cpi_mom", obs_date, expected, vintage,
                        "KALSHI", "API")]


COUNT_PLAUSIBLE = (0.0, 50_000.0)   # expected US data-center count


def fetch_dc(source_ids: list[str], vintage_date: str | None = None,
             http_get=None) -> list[Observation]:
    """DC context markets (KALSHI_DC isolation key — thin books must never
    fail the core CPI row). Unlike fetch(), a ticker with no priced markets
    is a SKIP, never an error: these books are speculative, absence is
    expected, and carry-forward + a render-when-present card absorb it.
    obs_date is the fetch date — standing questions, not monthly references.
    A ladder (>=2 strike markets) yields its survival-curve expected value;
    a single priced market is read as a binary probability."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out = []
    for ticker in source_ids:
        response = http_get(URL, params={"series_ticker": ticker,
                                         "status": "open", "limit": 100},
                            timeout=30)
        response.raise_for_status()
        markets = [m for m in response.json().get("markets", [])
                   if m.get("last_price_dollars") not in (None, "")
                   and float(m["last_price_dollars"]) > 0]
        if not markets:
            continue
        laddered = [m for m in markets if m.get("floor_strike") is not None]
        if len(laddered) >= 2:
            points = sorted((float(m["floor_strike"]),
                             min(float(m["last_price_dollars"]), 1.0))
                            for m in laddered)
            value = round(_expected_from_ladder(points), 2)
            if not COUNT_PLAUSIBLE[0] < value < COUNT_PLAUSIBLE[1]:
                raise ValueError(f"kalshi_dc {ticker}: expected {value} outside "
                                 f"{COUNT_PLAUSIBLE} — structure drift?")
        else:
            value = round(min(float(markets[0]["last_price_dollars"]), 1.0), 4)
        out.append(Observation(series_code=ticker, obs_date=vintage,
                               value=value, vintage_date=vintage,
                               source="KALSHI_DC", route="API"))
    return out
