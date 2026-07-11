"""Kalshi public market-data connector for CPI threshold probabilities."""
import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://external-api.kalshi.com/trade-api/v2/markets"


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
    nearest = min(events.values(),
                  key=lambda ms: min(m.get("close_time") or "9999" for m in ms))
    # These are cumulative "Above X%" binaries: price ≈ P(MoM > strike), a
    # survival curve — bucket masses are adjacent-price differences, valued at
    # bracket midpoints (tails extend half a typical bracket past the edge).
    points = sorted((float(m["floor_strike"]),
                     min(float(m["last_price_dollars"]), 1.0)) for m in nearest)
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
    expected = round(sum(v * m for v, m in zip(values, masses)), 6)
    return [Observation("kalshi_cpi_mom", vintage, expected, vintage,
                        "KALSHI", "API")]
