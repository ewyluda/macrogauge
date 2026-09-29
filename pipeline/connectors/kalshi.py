"""Kalshi public market-data connector for CPI threshold probabilities."""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import warn_partial
from pipeline.dates import month_first, prior_month
from pipeline.models import Observation

URL = "https://external-api.kalshi.com/trade-api/v2/markets"

MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
          "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
TICKER_RE = re.compile(r"-(\d{2})([A-Z]{3})$")


def _reference_month(event_ticker: str, close_time: str | None) -> str:
    """KXCPI-26JUN names the June data month. Fallback: markets close on
    release morning, and a CPI release covers the prior calendar month.

    Because obs_date is this month-start (not the trading day), its age vs
    today peaks at ~42d on release morning (e.g. an Aug-data market quoted
    until the ~Sep 10 print) even while fresh vintages land daily — so the
    series' max_staleness_days in config/series.json must be ≥ that peak
    (50, with margin), or sources_fresh false-positives from the 6th of
    every month."""
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


SERIES_CODES = {"KXCPI": "kalshi_cpi_mom", "KXCPICORE": "kalshi_core_cpi_mom"}


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
    if len(points) < 2:
        # One priced rung degenerates the survival curve: the "expected
        # value" clamps to strike ± half a default bracket no matter where
        # the market's true expectation sits. Error -> collect isolation
        # records it and carry-forward keeps yesterday's multi-rung value
        # (same reasoning as fetch_dc's degraded-ladder skip; here it is an
        # error because kalshi_cpi_mom feeds the published ensemble).
        raise ValueError(f"kalshi CPI {ticker}: single priced rung — "
                         "cannot form an expected value")
    expected = round(_expected_from_ladder(points), 6)
    close = min((m.get("close_time") for m in nearest if m.get("close_time")),
                default=None)
    obs_date = _reference_month(ticker, close)
    return [Observation(SERIES_CODES.get(series_ticker, "kalshi_cpi_mom"), obs_date,
                        expected, vintage, "KALSHI", "API")]


COUNT_PLAUSIBLE = (0.0, 50_000.0)   # expected US data-center count


def fetch_dc(source_ids: list[str], vintage_date: str | None = None,
             http_get=None) -> list[Observation]:
    """DC context markets (KALSHI_DC isolation key — thin books must never
    fail the core CPI row). Unlike fetch(), a ticker with no priced markets
    is a SKIP, never an error: these books are speculative, absence is
    expected, and carry-forward + a render-when-present card absorb it.
    obs_date is the fetch date — standing questions, not monthly references.
    Dispatch is shape-based on whether any priced market carries
    floor_strike: >=2 such markets is a ladder, yielding its survival-curve
    expected value; a single floor_strike market is a degraded ladder book
    (SKIP — its 0-1 price is not a resolvable count); zero floor_strike
    markets means the priced market is a true binary, read as a
    probability. Per-ticker errors (HTTP, drift) are contained the same way
    partial QCEW quarters are: the other tickers still publish and staleness
    QA flags the silent one — but every ticker failing raises."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out = []
    errors: list[tuple[str, Exception]] = []
    for ticker in source_ids:
        try:
            out.extend(_fetch_dc_ticker(ticker, vintage, http_get))
        except Exception as e:  # per-ticker: one bad book must not drop the rest
            errors.append((ticker, e))
    if errors and len(errors) == len(source_ids):
        if len(errors) == 1:  # nothing was isolated — surface the real exception
            raise errors[0][1]
        raise RuntimeError("kalshi_dc: all tickers failed — " + "; ".join(
            f"{t}: {type(e).__name__}" for t, e in errors))
    warn_partial("KALSHI_DC", errors)
    return out


def _fetch_dc_ticker(ticker: str, vintage: str, http_get) -> list[Observation]:
    response = http_get(URL, params={"series_ticker": ticker,
                                     "status": "open", "limit": 100},
                        timeout=30)
    response.raise_for_status()
    markets = [m for m in response.json().get("markets", [])
               if m.get("last_price_dollars") not in (None, "")
               and float(m["last_price_dollars"]) > 0]
    if not markets:
        return []
    # One series ticker spans event years (…-26DEC31, …-27DEC31): pooling
    # rungs across events would feed two years' ladders to the survival
    # curve as one book at every annual rollover. Keep only the event
    # closing next — same rule as fetch().
    events: dict[str, list[dict]] = {}
    for market in markets:
        events.setdefault(market.get("event_ticker", ""), []).append(market)
    markets = min(events.values(),
                  key=lambda ms: min(m.get("close_time") or "9999"
                                     for m in ms))
    laddered = [m for m in markets if m.get("floor_strike") is not None]
    if laddered and len(laddered) < 2:
        # Degraded ladder book: a market that carries floor_strike is a
        # ladder-style question, but one priced rung alone can't yield a
        # survival-curve expected value — and reading its 0-1 price as a
        # binary probability would publish a probability as a count
        # (confirmed live for 3 weeks in June 2026; recurs at every
        # annual event rollover as rungs get added/settled). Treat it
        # like a thin book: skip, carry-forward absorbs it.
        return []
    if len(laddered) >= 2:
        points = sorted((float(m["floor_strike"]),
                         min(float(m["last_price_dollars"]), 1.0))
                        for m in laddered)
        value = round(_expected_from_ladder(points), 2)
        if not COUNT_PLAUSIBLE[0] < value < COUNT_PLAUSIBLE[1]:
            raise ValueError(f"kalshi_dc {ticker}: expected {value} outside "
                             f"{COUNT_PLAUSIBLE} — structure drift?")
    else:
        # true binary: no priced market carries floor_strike at all
        value = round(min(float(markets[0]["last_price_dollars"]), 1.0), 4)
    return [Observation(series_code=ticker, obs_date=vintage,
                        value=value, vintage_date=vintage,
                        source="KALSHI_DC", route="API")]


# --- market-implied Fed path (backlog #10a; KALSHI_FED isolation key) --------
# KXFED-<YYMON> events are per-FOMC-meeting ladders of "upper bound of the
# target range ABOVE X% after the meeting" binaries on a 25bp grid (verified
# live 2026-09-28: 11-25 rungs per meeting, 0.00%..6.00%). Far-dated ladders
# are mostly one-sided resting quotes (bid 0.03 / ask 0.99) with junk last
# prices (non-monotone: 27APR T4.50 last 0.73, T4.75 last 0.00), so prices
# are bid/ask MIDS, rungs wider than FED_MAX_SPREAD are dropped, the survivors
# are forced non-increasing (pool-adjacent-violators), and a meeting is only
# published when its tight rungs bracket the mass (top S >= 0.9, bottom
# S <= 0.1). An illiquid meeting is skipped, never guessed.
FED_SERIES = "KXFED"
FED_STEP = 0.25                 # FOMC grid (percentage points)
FED_MAX_SPREAD = 0.10           # max yes ask - bid for a usable rung
FED_BRACKET = (0.9, 0.1)        # tight rungs must span S from >=0.9 to <=0.1
FED_PLAUSIBLE = (0.0, 15.0)     # upper bound, %
FED_RATE_RE = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2})?)\s*%\s*$")
FED_TICKER_RE = re.compile(r"^KXFED-\d{2}[A-Z]{3}$")


def _fed_markets(http_get, status: str, limit: int) -> list[dict]:
    response = http_get(URL, params={"series_ticker": FED_SERIES, "status": status,
                                     "limit": limit}, timeout=30)
    response.raise_for_status()
    markets = response.json().get("markets")
    if markets is None:
        raise ValueError(f"kalshi_fed: no 'markets' list ({status}) — structure drift?")
    return markets


def _fed_reference(settled: list[dict]) -> tuple[float, str]:
    """The upper bound now in effect: the most recently settled KXFED event's
    expiration_value ("4.00%") — the exact level the open ladders are quoted
    against. Returns (upper_bound_pct, event_ticker)."""
    done = [m for m in settled if m.get("expiration_value") and m.get("close_time")]
    if not done:
        raise ValueError("kalshi_fed: no settled KXFED market with an "
                         "expiration_value — structure drift?")
    last = max(done, key=lambda m: m["close_time"])
    hit = FED_RATE_RE.match(str(last["expiration_value"]))
    if not hit:
        raise ValueError(f"kalshi_fed: expiration_value {last['expiration_value']!r} "
                         "is not a percent — structure drift?")
    ref = float(hit[1])
    if not FED_PLAUSIBLE[0] <= ref <= FED_PLAUSIBLE[1]:
        raise ValueError(f"kalshi_fed: reference {ref} outside {FED_PLAUSIBLE}")
    return ref, last.get("event_ticker", "")


def _pav_nonincreasing(values: list[float]) -> list[float]:
    """Pool-adjacent-violators: the closest non-increasing sequence (L2)."""
    blocks: list[list[float]] = []          # [sum, count]
    for v in values:
        blocks.append([v, 1])
        while (len(blocks) > 1
               and blocks[-2][0] / blocks[-2][1] < blocks[-1][0] / blocks[-1][1]):
            s, c = blocks.pop()
            blocks[-1][0] += s
            blocks[-1][1] += c
    out: list[float] = []
    for s, c in blocks:
        out.extend([s / c] * int(c))
    return out


def _fed_curve(markets: list[dict]) -> list[tuple[float, float]] | None:
    """[(strike, P(upper > strike))] over the tight rungs, monotone; None when
    the meeting's liquid rungs don't bracket the distribution."""
    rungs = []
    for m in markets:
        strike = m.get("floor_strike")
        bid, ask = m.get("yes_bid_dollars"), m.get("yes_ask_dollars")
        if strike is None or bid in (None, "") or ask in (None, ""):
            continue
        bid, ask = float(bid), float(ask)
        if ask < bid or not (0 <= bid <= 1 and 0 <= ask <= 1):
            raise ValueError(f"kalshi_fed {m.get('ticker')}: bid {bid} / ask {ask} "
                             "not a 0-1 quote — structure drift?")
        steps = float(strike) / FED_STEP
        if abs(steps - round(steps)) > 1e-6:
            raise ValueError(f"kalshi_fed {m.get('ticker')}: strike {strike} off the "
                             f"{FED_STEP}pp grid — structure drift?")
        if ask - bid <= FED_MAX_SPREAD + 1e-9:
            rungs.append((float(strike), (bid + ask) / 2))
    if len(rungs) < 2:
        return None
    rungs.sort()
    probs = _pav_nonincreasing([p for _, p in rungs])
    if probs[0] < FED_BRACKET[0] or probs[-1] > FED_BRACKET[1]:
        return None
    return [(s, min(max(p, 0.0), 1.0)) for (s, _), p in zip(rungs, probs)]


def _fed_expected(curve: list[tuple[float, float]]) -> float:
    """E[upper bound] on the 25bp grid. Mass between tight rungs a < b sits on
    the grid points a+0.25..b (their mean when a dropped rung left a gap; b
    itself when adjacent); below the bottom rung at it, above the top rung
    one step past it."""
    strikes = [s for s, _ in curve]
    probs = [p for _, p in curve]
    total = (1 - probs[0]) * strikes[0] + probs[-1] * (strikes[-1] + FED_STEP)
    for (a, pa), (b, pb) in zip(curve, curve[1:]):
        total += (pa - pb) * (a + FED_STEP + b) / 2
    return total


def _survival_at(curve: list[tuple[float, float]], strike: float) -> float | None:
    for s, p in curve:
        if abs(s - strike) < 1e-9:
            return p
    return None


def fetch_fed(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """Per upcoming meeting (obs_date = decision date): kalshi_fed_upper
    (expected upper bound, %), kalshi_fed_quoted (fetch-date stamp) and
    kalshi_fed_p_cut / _p_hold / _p_hike (vs the upper bound now in effect,
    cumulative to that meeting). One freshness
    sentinel, kalshi_fed_ref_upper (obs_date = fetch date), carries the
    reference level — the per-meeting rows are future-dated, so the sentinel
    is what goes stale when the source breaks."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    ref, ref_event = _fed_reference(_fed_markets(http_get, "settled", 50))
    events: dict[str, list[dict]] = {}
    for m in _fed_markets(http_get, "open", 1000):
        ev = m.get("event_ticker") or ""
        if not FED_TICKER_RE.match(ev):
            raise ValueError(f"kalshi_fed: unexpected event ticker {ev!r} — "
                             "structure drift?")
        events.setdefault(ev, []).append(m)
    out = [Observation("kalshi_fed_ref_upper", vintage, ref, vintage,
                       "KALSHI_FED", "API")]
    usable = 0
    for ev, ms in sorted(events.items(),
                         key=lambda kv: min(m.get("close_time") or "9999" for m in kv[1])):
        close = min((m["close_time"] for m in ms if m.get("close_time")), default=None)
        if close is None or close[:10] < vintage:
            continue
        curve = _fed_curve(ms)
        if curve is None:
            continue            # illiquid ladder: skip, never guess
        expected = round(_fed_expected(curve), 4)
        if not FED_PLAUSIBLE[0] <= expected <= FED_PLAUSIBLE[1]:
            raise ValueError(f"kalshi_fed {ev}: expected {expected} outside "
                             f"{FED_PLAUSIBLE} — structure drift?")
        meeting = close[:10]
        usable += 1
        out.append(Observation("kalshi_fed_upper", meeting, expected, vintage,
                               "KALSHI_FED", "API"))
        # The store appends only CHANGED values, so a meeting skipped today
        # (illiquid) would keep its last value indistinguishable from an
        # unchanged quote. This stamp (the fetch date as YYYYMMDD) changes
        # every day a meeting IS quoted; the writer publishes only meetings
        # stamped on the latest fetch.
        out.append(Observation("kalshi_fed_quoted", meeting,
                               float(vintage.replace("-", "")), vintage,
                               "KALSHI_FED", "API"))
        s_hike = _survival_at(curve, ref)
        s_hold = _survival_at(curve, ref - FED_STEP)
        if s_hike is not None and s_hold is not None:
            for code, v in (("kalshi_fed_p_cut", 1 - s_hold),
                            ("kalshi_fed_p_hold", s_hold - s_hike),
                            ("kalshi_fed_p_hike", s_hike)):
                out.append(Observation(code, meeting, round(v, 4), vintage,
                                       "KALSHI_FED", "API"))
    if not usable:
        raise ValueError(f"kalshi_fed: no meeting ladder liquid enough "
                         f"({len(events)} open events, ref {ref_event})")
    return out
