"""Vintage-true (real-time) gauge track — backlog #2, 2026-09-28.

The published daily history is a HINDSIGHT series: a monthly official row is
applied from its obs_date (month m's CPI from m-01), ~6 weeks before BLS
released it, so compare.json's validation stats and the homepage lead-lag
correlation graded the gauge with prints it could not yet have seen.

This module rebuilds, for each month-end E, the headline as it could have been
known ON E, cheaply and without re-running the engine: for every component,
take its own-observation YoY (the hindsight run's `own_yoy_daily`) at the
latest of its observation dates that was AVAILABLE by E, then weight with the
weights in force at E (the engine's time-varying weights). That reproduces
the engine's construction because each own-obs YoY is a ratio of two points
of a series built only from data at or before them (blend renormalization
and splice scales are fixed by the past; rebase cancels in the ratio).
Not replayed: one-day quality-gate holds, later revisions to live sources
(read at their latest vintage), and the utilities' year-ratio tail, which
re-anchors on the newest print (only ever present past the last print).
Methodology is today's throughout the reconstruction; ledger rows carry the
methodology in force the day they were published.

Availability of an observation date t of a component:
  * an OFFICIAL point (bls_cf components, the CPI residual, and live
    components before their live data starts) — the first-release date of
    that month's CPI (CPIAUCNS ALFRED vintages; the CUUR component indexes
    and the residual release with the headline the same morning);
  * a LIVE point — t + the component's publication lag (the source's typical
    first-vintage lag, net of any lead_days shift), measured from genuine
    arrivals in the vintage store.

Real publish-ledger rows (store/ledger/pulse.jsonl, since 2026-07-08) replace
the reconstruction for any month-end the ledger covers: those are what the
site actually said that day.

Pure functions of dicts; compare.py does the store/ledger I/O.
"""
import statistics
from datetime import date, timedelta

from pipeline.engine import aggregate

DEFAULT_OFFICIAL_LAG_DAYS = 45   # a month without a known CPI release date
GENUINE_LAG_MAX_DAYS = 120       # longer first-vintage lags are backfills
LEDGER_WINDOW_DAYS = 7           # a ledger row within a week of E is "that month-end"


def typical_lag(first_releases: list[tuple[str, float, str]]) -> int:
    """Median publication lag (days, first vintage - obs_date) over GENUINE
    arrivals: rows first seen after the series' initial backfill vintage, and
    within GENUINE_LAG_MAX_DAYS (older first vintages are history pulled in
    later). Rounded up; 0 when the store has no genuine arrival yet."""
    if not first_releases:
        return 0
    initial = min(v for _, _, v in first_releases)
    lags = []
    for d, _, v in first_releases:
        if v <= initial:
            continue
        lag = (date.fromisoformat(v) - date.fromisoformat(d)).days
        if 0 <= lag <= GENUINE_LAG_MAX_DAYS:
            lags.append(lag)
    if not lags:
        return 0
    med = statistics.median(lags)
    return int(med) if med == int(med) else int(med) + 1


def month_end(m: str, cap: str) -> str:
    """Last calendar day of month m (YYYY-MM[-DD]), capped at `cap`."""
    y, mo = int(m[:4]), int(m[5:7])
    nxt = date(y + (mo == 12), mo % 12 + 1, 1)
    return min((nxt - timedelta(days=1)).isoformat(), cap)


def _available(t: str, live_from: str | None, lag_days: int,
               release: dict[str, str]) -> str:
    if live_from is None or t < live_from:  # official point
        r = release.get(t[:7])
        if r is not None:
            return r
        return (date.fromisoformat(t) + timedelta(days=DEFAULT_OFFICIAL_LAG_DAYS)).isoformat()
    return (date.fromisoformat(t) + timedelta(days=lag_days)).isoformat()


def component_yoy_known_on(entry: dict, e: str, lag_days: int,
                           release: dict[str, str]) -> float | None:
    """A component's own-obs YoY as known on date `e`: at its latest
    observation date that was available by e. None if none was."""
    obs = entry.get("obs_dates") or []
    live_from = entry.get("live_from")
    for t in reversed(obs):
        if t > e:
            continue
        if _available(t, live_from, lag_days, release) <= e:
            return entry["own_yoy_daily"].get(t)
    return None


def headline_known_on(variant: dict, e: str, lags: dict[str, int],
                      release: dict[str, str]) -> float | None:
    """Σ w_i(base(e)) · yoy_i(as known on e), renormalized; None when any
    component has nothing known yet."""
    comps = variant["components"]
    wbm = variant.get("weights_by_month") or {}
    w = wbm.get(aggregate.base_month(e)) or {k: c["weight"] for k, c in comps.items()}
    total, acc = 0.0, 0.0
    for code, entry in comps.items():
        y = component_yoy_known_on(entry, e, lags.get(code, 0), release)
        if y is None:
            return None
        acc += w[code] * y
        total += w[code]
    return acc / total if total else None


def ledger_reading(rows: list[dict], e: str, field: str = "gauge_yoy_pct"
                   ) -> float | None:
    """The last published reading dated within LEDGER_WINDOW_DAYS up to e."""
    lo = (date.fromisoformat(e) - timedelta(days=LEDGER_WINDOW_DAYS)).isoformat()
    best = None
    for r in rows:  # ledger rows are sorted by published_at
        d = r.get("date")
        if d and lo < d <= e and r.get(field) is not None:
            best = r[field]
    return best


def track(variant: dict, months: list[str], lags: dict[str, int],
          release: dict[str, str], ledger_rows: list[dict] | None = None
          ) -> dict:
    """{dates, months, gauge_yoy_pct, source} for each month in `months`
    (YYYY-MM-01): the headline as known at that month's end."""
    cap = variant["as_of"]
    dates, vals, sources = [], [], []
    for m in months:
        e = month_end(m, cap)
        led = ledger_reading(ledger_rows or [], e)
        if led is not None:
            vals.append(round(led, 2))
            sources.append("ledger")
        else:
            v = headline_known_on(variant, e, lags, release)
            vals.append(None if v is None else round(v, 2))
            sources.append("reconstructed")
        dates.append(e)
    return {"dates": dates, "months": list(months), "gauge_yoy_pct": vals,
            "source": sources}
