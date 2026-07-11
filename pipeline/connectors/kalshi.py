"""Kalshi public market-data connector for CPI bracket probabilities."""
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
    markets = response.json().get("markets", [])
    points = []
    for market in markets:
        strike = market.get("floor_strike")
        price = market.get("last_price_dollars")
        if strike is None or price in (None, ""):
            continue
        points.append((float(strike), float(price)))
    if not points:
        raise ValueError("no priced Kalshi CPI markets")
    total = sum(p for _, p in points)
    expected = round(sum(strike * probability for strike, probability in points) / total, 6)
    return [Observation("kalshi_cpi_mom", vintage, expected, vintage,
                        "KALSHI", "API")]
