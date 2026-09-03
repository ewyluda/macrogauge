"""Writer for rates.json — the Treasury curve, breakevens, credit, dollar,
liquidity and mortgage spread the pipeline already collects daily.

Display-only unlock (batch 4a, 2026-09-03): pure store -> writer, never
touches the gauge engine. Every derived number is arithmetic on published
levels — 2s10s = DGS10 - DGS2, 10y real = DGS10 - T10YIE, net liquidity =
WALCL - TGA - RRP — and the page says so. Units are normalized here, once:
WALCL and WTREGEN are FRED millions of dollars, RRPONTSYD is billions; all
three publish in $bn (UNITS_BN pins the divisors). A series with no store
rows publishes a null block: a new writer must never take down the run.
"""
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.publish.util import (delta_daily, latest_point, nearest_on_or_before,
                                   pct_change_daily, tail, write_json)
from pipeline.store import vintage

TENORS = [("DGS1MO", "1M", 1 / 12), ("DGS3MO", "3M", 0.25), ("DGS6MO", "6M", 0.5),
          ("DGS1", "1Y", 1.0), ("DGS2", "2Y", 2.0), ("DGS5", "5Y", 5.0),
          ("DGS10", "10Y", 10.0), ("DGS30", "30Y", 30.0)]
# FRED unit -> $bn divisor
UNITS_BN = {"WALCL": 1000.0, "WTREGEN": 1000.0, "RRPONTSYD": 1.0}
TAIL_OBS = 60
HISTORY_DAILY_CODES = {"dgs3mo": "DGS3MO", "dgs2": "DGS2", "dgs10": "DGS10",
                       "t5yie": "T5YIE", "t10yie": "T10YIE",
                       "hy_oas": "BAMLH0A0HYM2", "dollar": "DTWEXBGS"}


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _lookback(obs, as_of, days):
    """Value nearest `days` before as_of (±3d), for the curve snapshots."""
    from datetime import date, timedelta
    target = date.fromisoformat(as_of) - timedelta(days=days)
    for offset in (0, -1, 1, -2, 2, -3, 3):
        v = obs.get((target + timedelta(days=offset)).isoformat())
        if v is not None:
            return round(v, 4)
    return None


def _curve(conn):
    rows = []
    for code, label, years in TENORS:
        obs = _rows(conn, code)
        as_of, value = latest_point(obs)
        # 1-day move = vs the PREVIOUS observation, not a ±3d window (which
        # would resolve to as_of itself and print 0.0 every Monday)
        prior = sorted(obs)[-2] if len(obs) > 1 else None
        rows.append({"code": code, "label": label, "years": round(years, 4),
                     "value": value, "as_of": as_of,
                     "chg_1d_pp": None if prior is None else round(obs[as_of] - obs[prior], 4),
                     "chg_30d_pp": delta_daily(obs, as_of, 30) if as_of else None,
                     "chg_1y_pp": delta_daily(obs, as_of, 365) if as_of else None,
                     "value_30d_ago": _lookback(obs, as_of, 30) if as_of else None,
                     "value_1y_ago": _lookback(obs, as_of, 365) if as_of else None})
    return rows


def _spread(a, b, label):
    """a - b on their latest common date; null when either is absent."""
    common = sorted(set(a) & set(b))
    if not common:
        return {"label": label, "value": None, "as_of": None, "chg_30d_pp": None,
                "chg_1y_pp": None}
    diff = {d: a[d] - b[d] for d in common}
    as_of = common[-1]
    return {"label": label, "value": round(diff[as_of], 4), "as_of": as_of,
            "chg_30d_pp": delta_daily(diff, as_of, 30),
            "chg_1y_pp": delta_daily(diff, as_of, 365)}


def _history(conn):
    """Daily history since PUBLISH_START on DGS10's business-day grid; other
    series null where they lack a row that day."""
    series = {k: _rows(conn, c) for k, c in HISTORY_DAILY_CODES.items()}
    dates = sorted(d for d in series["dgs10"] if d >= PUBLISH_START)
    out = {"dates": dates}
    for k, obs in series.items():
        out[k] = [None if d not in obs else round(obs[d], 4) for d in dates]
    out["spread_2s10s"] = [None if a is None or b is None else round(a - b, 4)
                           for a, b in zip(out["dgs10"], out["dgs2"])]
    out["spread_3m10y"] = [None if a is None or b is None else round(a - b, 4)
                           for a, b in zip(out["dgs10"], out["dgs3mo"])]
    out["real_10y"] = [None if a is None or b is None else round(a - b, 4)
                       for a, b in zip(out["dgs10"], out["t10yie"])]
    return out


def _liquidity(conn):
    walcl = {d: v / UNITS_BN["WALCL"] for d, v in _rows(conn, "WALCL").items()}
    tga = {d: v / UNITS_BN["WTREGEN"] for d, v in _rows(conn, "WTREGEN").items()}
    rrp = {d: v / UNITS_BN["RRPONTSYD"] for d, v in _rows(conn, "RRPONTSYD").items()}
    weeks = sorted(d for d in walcl if d >= PUBLISH_START)
    rows = []
    for d in weeks:
        t = nearest_on_or_before(tga, d)
        r = nearest_on_or_before(rrp, d)
        net = None if t is None or r is None else walcl[d] - t - r
        rows.append((d, walcl[d], t, r, net))
    latest = rows[-1] if rows else (None, None, None, None, None)
    return {"as_of": latest[0],
            "walcl_bn": None if latest[1] is None else round(latest[1], 1),
            "tga_bn": None if latest[2] is None else round(latest[2], 1),
            "rrp_bn": None if latest[3] is None else round(latest[3], 1),
            "net_bn": None if latest[4] is None else round(latest[4], 1),
            "units": "USD billions; net = WALCL - TGA - RRP",
            "history": {"dates": [r[0] for r in rows],
                        "walcl_bn": [round(r[1], 1) for r in rows],
                        "tga_bn": [None if r[2] is None else round(r[2], 1) for r in rows],
                        "rrp_bn": [None if r[3] is None else round(r[3], 1) for r in rows],
                        "net_bn": [None if r[4] is None else round(r[4], 1) for r in rows]}}


def _level(conn, code, pct=True):
    obs = _rows(conn, code)
    as_of, value = latest_point(obs)
    if as_of is None:
        return {"code": code, "value": None, "as_of": None, "chg_30d": None,
                "chg_1y": None, "tail": {"dates": [], "values": []}}
    fn = pct_change_daily if pct else delta_daily
    return {"code": code, "value": value, "as_of": as_of,
            "chg_30d": fn(obs, as_of, 30), "chg_1y": fn(obs, as_of, 365),
            "tail": tail(obs, TAIL_OBS)}


def _mortgage(conn):
    pmms, mnd, dgs10 = _rows(conn, "pmms_30yr"), _rows(conn, "mnd_30y_d"), _rows(conn, "DGS10")
    p_as_of, p_val = latest_point(pmms)
    m_as_of, m_val = latest_point(mnd)
    weeks = sorted(d for d in pmms if d >= PUBLISH_START)
    spread_hist = []
    for d in weeks:
        y = nearest_on_or_before(dgs10, d)
        spread_hist.append(None if y is None else round(pmms[d] - y, 4))
    spread = next((s for s in reversed(spread_hist) if s is not None), None)
    return {"pmms_30yr": {"value": p_val, "as_of": p_as_of},
            "mnd_30yr_daily": {"value": m_val, "as_of": m_as_of},
            "spread_to_10y_pp": spread,
            "history": {"dates": weeks,
                        "pmms_30yr": [round(pmms[d], 4) for d in weeks],
                        "spread_to_10y_pp": spread_hist}}


def build(conn) -> dict:
    dgs = {code: _rows(conn, code) for code, _, _ in TENORS}
    t10 = _rows(conn, "T10YIE")
    return {"curve": _curve(conn),
            "spreads": {"s2s10s": _spread(dgs["DGS10"], dgs["DGS2"], "2s10s"),
                        "s3m10y": _spread(dgs["DGS10"], dgs["DGS3MO"], "3m10y"),
                        "real_10y": _spread(dgs["DGS10"], t10, "10y real (DGS10 - T10YIE)")},
            "breakevens": {"t5yie": _level(conn, "T5YIE", pct=False),
                           "t10yie": _level(conn, "T10YIE", pct=False)},
            "credit": {"hy_oas": _level(conn, "BAMLH0A0HYM2", pct=False)},
            "dollar": _level(conn, "DTWEXBGS", pct=True),
            "gdpnow": _level(conn, "GDPNOW", pct=False),
            "auto_loan_60m": _level(conn, "RIFLPBCIANM60NM", pct=False),
            "liquidity": _liquidity(conn),
            "mortgage": _mortgage(conn),
            "history": _history(conn)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "rates.json")
