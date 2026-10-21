"""Writer for gas.json — natural gas as the fuel behind AI power (/gas,
2026-10-19).

Display-only, pure store -> writer; never an index leg. Five blocks:

- Henry Hub spot (EIA daily) with its 30-day average and the same window a
  year earlier, the NYMEX front month (FMP), and EIA's STEO Henry Hub path.
  STEO rows carry future obs_dates, which registry staleness cannot see
  (codebase review A3), so this writer dates the forecast by the vintage it
  arrived in and marks it `stale` past STEO_STALE_DAYS.
- Storage: Lower-48 working gas against OUR five-year average — the same ISO
  week in each of the five prior years, which tracks but is not EIA's own
  published average.
- Demand: power-sector burn and LNG exports in Bcf/d (monthly MMcf over the
  month's days), latest month and trailing twelve months, each against the
  year before.
- Power vs gas: each configured wholesale hub's 30-day average divided by
  Henry Hub's average over the SAME 30 days, ending at the earlier of the two
  series' last prints (a biweekly ICE hub is never measured against gas days
  it hasn't reached, and a daily hub never against gas EIA hasn't printed
  yet), now and a year earlier. The ratio is MMBtu per MWh: a hub whose price is just a
  combined cycle's fuel bill sits near its heat rate. It is Henry Hub, not
  the hub's local gas, and on-peak products run higher than all-hours ones —
  the page says both.
- Fuel arithmetic: fuel $/MWh per prime mover at Henry Hub's 30-day average
  (and STEO's next twelve full calendar months), and the gas the curated
  gas-fired AI power deals' own gas plants would burn at full output — on each
  plant's stated MW from config/gas.json, never the deal's contracted or
  bundled MW. Full output is an upper bound, not a forecast; no load factor is
  assumed.

A series with no store rows publishes a null block; a broken fuel config or
deals config nulls only the blocks that need it.
"""
import calendar
from datetime import date, timedelta
from pathlib import Path

from pipeline.engine.dcindex import HUB_WINDOW_DAYS, window_avg
from pipeline.engine.gauge import PUBLISH_START
from pipeline.publish.util import pct_change_daily, write_json, yoy_pct
from pipeline.store import vintage

HH, FUT, STEO = "eia_henry_hub", "fmp_natgas", "steo_ng_hh"
STORAGE, BURN, LNG = "eia_ng_storage", "eia_ng_power_burn", "eia_lng_exports"
STEO_STALE_DAYS = 45      # STEO publishes monthly; two missed releases is stale
STORAGE_WEEKS = 52        # storage history shipped for the chart
DEMAND_MONTHS = 36        # demand history shipped for the chart
FORWARD_MONTHS = 12
HOURS_PER_YEAR = 8760
DEAL_STATUSES_SIGNED = {"signed"}


def _rows(conn, code):
    return vintage.latest(conn, code)


def _r(v, nd=2):
    return None if v is None else round(v, nd)


def _pct(a, b, nd=1):
    return None if a is None or b in (None, 0) or b < 0 else round((a / b - 1) * 100, nd)


def henry_hub(conn) -> dict | None:
    rows = _rows(conn, HH)
    if not rows:
        return None
    obs = dict(rows)
    as_of, latest = rows[-1]
    end = date.fromisoformat(as_of)
    avg = window_avg(rows, end)
    prior = window_avg(rows, end - timedelta(days=365))
    year = [v for d, v in rows if date.fromisoformat(d) > end - timedelta(days=365)]
    return {"code": HH, "latest": _r(latest), "as_of": as_of,
            "avg30": _r(avg), "avg30_year_ago": _r(prior), "avg30_yoy_pct": _pct(avg, prior),
            "chg_30d_pct": pct_change_daily(obs, as_of, 30),
            "low_52w": _r(min(year)), "high_52w": _r(max(year))}


def futures(conn, spot: dict | None) -> dict | None:
    rows = _rows(conn, FUT)
    if not rows:
        return None
    obs = dict(rows)
    as_of, latest = rows[-1]
    then = None if spot is None else obs.get(spot["as_of"])
    vs_spot = None if then is None else _r(then - spot["latest"])
    return {"code": FUT, "latest": _r(latest), "as_of": as_of,
            "chg_30d_pct": pct_change_daily(obs, as_of, 30),
            "chg_1y_pct": pct_change_daily(obs, as_of, 365),
            # front month minus spot ON THE SPOT'S DATE (EIA spot lags the
            # futures by about a week): positive = the market pays more for
            # next month's gas than that day's (a winter premium in the fall)
            "vs_spot": vs_spot, "vs_spot_as_of": None if vs_spot is None else spot["as_of"]}


def outlook(conn, today: str) -> dict | None:
    """STEO's Henry Hub path from the current month on, dated by the vintage
    the newest forecast row arrived in."""
    month0 = today[:7] + "-01"
    fc = conn.execute(
        "SELECT MAX(vintage_date) FROM observations WHERE series_code = ? AND obs_date >= ?",
        (STEO, month0)).fetchone()[0]
    rows = [(d, v) for d, v in _rows(conn, STEO) if d >= month0]
    if not rows or fc is None:
        return None
    # the next twelve CALENDAR months from the current one, each required: a
    # missing month must not pull a 13th month into the window (PR #134 review)
    obs = dict(rows)
    window = [_add_months(month0, k) for k in range(FORWARD_MONTHS)]
    vals = [obs.get(m) for m in window]
    age = (date.fromisoformat(today) - date.fromisoformat(fc)).days
    return {"code": STEO, "release_seen": fc, "stale": age > STEO_STALE_DAYS,
            "months": [d for d, _ in rows], "values": [_r(v) for _, v in rows],
            "next12_avg": None if any(v is None for v in vals) else _r(sum(vals) / FORWARD_MONTHS),
            "next12_from": window[0], "next12_to": window[-1]}


def _add_months(month: str, k: int) -> str:
    d = date.fromisoformat(month)
    y, m = divmod(d.month - 1 + k, 12)
    return f"{d.year + y:04d}-{m + 1:02d}-01"


def history(conn) -> dict:
    rows = [(d, v) for d, v in _rows(conn, HH) if d >= PUBLISH_START]
    return {"dates": [d for d, _ in rows], "henry_hub": [_r(v) for _, v in rows]}


def _iso(d: str) -> tuple[int, int]:
    y, w, _ = date.fromisoformat(d).isocalendar()
    return y, w


def _avg5(by_week: dict, d: str) -> float | None:
    """Mean of the same ISO week in the five prior years (week 53, which most
    years lack, falls back to week 52); None unless all five print."""
    y, w = _iso(d)
    vals = [by_week.get((y - k, w), by_week.get((y - k, 52)) if w == 53 else None)
            for k in range(1, 6)]
    return None if any(v is None for v in vals) else sum(vals) / 5


def storage(conn) -> dict | None:
    rows = _rows(conn, STORAGE)
    if not rows:
        return None
    by_week = {_iso(d): v for d, v in rows}
    as_of, bcf = rows[-1]
    y, w = _iso(as_of)
    avg5 = _avg5(by_week, as_of)
    year_ago = by_week.get((y - 1, w))
    # the change "on the week" needs the print exactly seven days earlier; a
    # missing week must not publish a two-week move under that label
    prev = dict(rows).get((date.fromisoformat(as_of) - timedelta(days=7)).isoformat())
    hist = rows[-STORAGE_WEEKS:]
    return {"code": STORAGE, "as_of": as_of, "bcf": round(bcf),
            "chg_week_bcf": None if prev is None else round(bcf - prev),
            "avg5_bcf": None if avg5 is None else round(avg5),
            "vs_avg5_pct": _pct(bcf, avg5),
            "year_ago_bcf": None if year_ago is None else round(year_ago),
            "vs_year_ago_pct": _pct(bcf, year_ago),
            "history": {"dates": [d for d, _ in hist], "bcf": [round(v) for _, v in hist],
                        "avg5_bcf": [None if (a := _avg5(by_week, d)) is None else round(a)
                                     for d, _ in hist]}}


def _bcf_d(month: str, mmcf: float) -> float:
    d = date.fromisoformat(month)
    return mmcf / calendar.monthrange(d.year, d.month)[1] / 1000.0


def _ttm(per_day: dict, end: str) -> float | None:
    """Trailing-twelve-month Bcf/d ending at `end`: total volume over total
    days, so a 31-day month weighs more than February. None with a gap."""
    d = date.fromisoformat(end)
    out_vol = out_days = 0.0
    y, m = d.year, d.month
    for _ in range(12):
        key = f"{y:04d}-{m:02d}-01"
        if key not in per_day:
            return None
        days = calendar.monthrange(y, m)[1]
        out_vol += per_day[key] * days
        out_days += days
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out_vol / out_days


def _demand_series(conn, code: str) -> tuple[dict, dict] | None:
    """(published block, {month: Bcf/d}) or None with no store rows."""
    rows = _rows(conn, code)
    if not rows:
        return None
    per_day = {d: _bcf_d(d, v) for d, v in rows}
    as_of = rows[-1][0]
    ttm = _ttm(per_day, as_of)
    end = date.fromisoformat(as_of)
    prior_end = f"{end.year - 1:04d}-{end.month:02d}-01"
    ttm_prior = _ttm(per_day, prior_end)
    return {"code": code, "as_of": as_of, "bcf_d": _r(per_day[as_of]),
            "yoy_pct": yoy_pct(per_day, as_of),
            "ttm_bcf_d": _r(ttm), "ttm_yoy_pct": _pct(ttm, ttm_prior)}, per_day


def demand(conn) -> dict | None:
    burn, lng = _demand_series(conn, BURN), _demand_series(conn, LNG)
    if burn is None and lng is None:
        return None
    months = sorted(set(burn[1] if burn else {}) | set(lng[1] if lng else {}))[-DEMAND_MONTHS:]
    return {"power_burn": burn[0] if burn else None,
            "lng_exports": lng[0] if lng else None,
            "history": {"months": months,
                        "power_burn_bcf_d": [_r(burn[1].get(m)) if burn else None for m in months],
                        "lng_exports_bcf_d": [_r(lng[1].get(m)) if lng else None for m in months]}}


def power_vs_gas(conn, power_cfg, cc_mmbtu_per_mwh: float | None) -> list[dict] | None:
    gas = _rows(conn, HH)
    if not gas or power_cfg is None:
        return None
    out = []
    for h in power_cfg.hubs:
        rows = _rows(conn, h.code)
        if not rows:
            continue
        end = min(date.fromisoformat(rows[-1][0]), date.fromisoformat(gas[-1][0]))
        p, g = window_avg(rows, end), window_avg(gas, end)
        p0, g0 = window_avg(rows, end - timedelta(days=365)), window_avg(gas, end - timedelta(days=365))
        ratio = p / g if p is not None and g else None
        ratio0 = p0 / g0 if p0 is not None and g0 else None
        out.append({"code": h.code, "label": h.label, "grid": h.grid, "region": h.region,
                    "product": h.product, "as_of": end.isoformat(),
                    "power_avg30": _r(p), "gas_avg30": _r(g, 3), "ratio": _r(ratio),
                    "power_avg30_year_ago": _r(p0), "gas_avg30_year_ago": _r(g0, 3),
                    "ratio_year_ago": _r(ratio0),
                    "power_yoy_pct": _pct(p, p0), "gas_yoy_pct": _pct(g, g0),
                    "ratio_yoy_pct": _pct(ratio, ratio0),
                    # how far above a combined cycle's fuel bill the hub clears
                    "vs_cc_fuel": (None if ratio is None or not cc_mmbtu_per_mwh
                                   else _r(ratio / cc_mmbtu_per_mwh))})
    out.sort(key=lambda r: -(r["ratio"] if r["ratio"] is not None else -1))
    return out


def fuel_cost(gas_cfg, spot: dict | None, fwd: dict | None) -> dict | None:
    if gas_cfg is None or spot is None or spot["avg30"] is None:
        return None
    price = spot["avg30"]
    forward = None if fwd is None or fwd["stale"] else fwd["next12_avg"]
    rows = []
    for hr in gas_cfg.heat_rates:
        mwh = hr.mmbtu_per_mwh
        rows.append({"key": hr.key, "label": hr.label, "btu_per_kwh": hr.btu_per_kwh,
                     "year": hr.year, "source_url": hr.url,
                     "fuel_usd_mwh": _r(price * mwh),
                     "fuel_usd_mwh_forward": None if forward is None else _r(forward * mwh),
                     "usd_per_mw_year": round(price * mwh * HOURS_PER_YEAR),
                     # what each +$1/MMBtu adds
                     "per_dollar_usd_mwh": _r(mwh),
                     "per_dollar_usd_per_mw_year": round(mwh * HOURS_PER_YEAR)})
    return {"gas_price": price, "gas_as_of": spot["as_of"], "forward_price": forward,
            "basis": gas_cfg.basis, "heat_rates": rows}


def _bcf_d_full_output(mw: float, gas_cfg, hr) -> float:
    mmbtu_d = mw * 24 * hr.mmbtu_per_mwh
    return mmbtu_d / (gas_cfg.btu_per_cf / 1000.0) / 1e6   # MMBtu -> Mcf -> Bcf


def ai_gas_deals(deals_cfg, gas_cfg, dem: dict | None) -> dict | None:
    """Gas-tagged power deals with the gas plant's own stated MW beside the
    deal's MW (contracted load or a resource bundle), and burn computed on the
    gas MW only. A deal whose sources do not split the gas out keeps a null
    gas MW and burn, and is counted apart (`*_unstated_mw`), never guessed."""
    if deals_cfg is None or gas_cfg is None:
        return None
    cc = next((h for h in gas_cfg.heat_rates if h.key == "combined_cycle"), None)
    if cc is None:
        return None
    gas = sorted((d for d in deals_cfg.deals if d.technology == "gas"),
                 key=lambda d: (d.status not in DEAL_STATUSES_SIGNED, -d.mw_total, d.t))
    rows = []
    for d in gas:
        g = gas_cfg.generation.get((d.t, d.facility))
        gmw = None if g is None else g.gas_mw
        rows.append((d, gmw, None if g is None else g.note))
    signed = [(d, m) for d, m, _ in rows if d.status in DEAL_STATUSES_SIGNED]
    other = [(d, m) for d, m, _ in rows if d.status not in DEAL_STATUSES_SIGNED]
    signed_mw = sum(m for _, m in signed if m is not None)
    other_mw = sum(m for _, m in other if m is not None)
    sb, ob = _bcf_d_full_output(signed_mw, gas_cfg, cc), _bcf_d_full_output(other_mw, gas_cfg, cc)
    burn = (dem or {}).get("power_burn") or {}
    ttm = burn.get("ttm_bcf_d")
    return {"as_of_curated": deals_cfg.as_of_curated, "heat_rate_key": cc.key,
            "btu_per_kwh": cc.btu_per_kwh, "btu_per_cf": gas_cfg.btu_per_cf,
            "heat_content_year": gas_cfg.heat_content_year,
            "generation_basis": gas_cfg.generation_basis,
            "signed_gas_mw": signed_mw, "other_gas_mw": other_mw,
            "signed_unstated_mw": sum(d.mw_total for d, m in signed if m is None),
            "other_unstated_mw": sum(d.mw_total for d, m in other if m is None),
            "signed_bcf_d": round(sb, 3), "other_bcf_d": round(ob, 3),
            "power_burn_ttm_bcf_d": ttm,
            "signed_share_of_power_burn_pct": None if not ttm else round(sb / ttm * 100, 1),
            "all_share_of_power_burn_pct": None if not ttm else round((sb + ob) / ttm * 100, 1),
            "deals": [{"t": d.t, "counterparty": d.counterparty, "facility": d.facility,
                       "mw": d.mw_total, "mw_basis": d.mw_basis, "gas_mw": m, "gas_mw_note": note,
                       "status": d.status, "kind": d.kind,
                       "announced": d.announced, "source_url": d.src_url,
                       "bcf_d_full_output": (None if m is None
                                             else round(_bcf_d_full_output(m, gas_cfg, cc), 3))}
                      for d, m, note in rows]}


def build(conn, today: str, power_cfg=None, gas_cfg=None, deals_cfg=None) -> dict:
    spot = henry_hub(conn)
    fwd = outlook(conn, today)
    dem = demand(conn)
    cc = next((h.mmbtu_per_mwh for h in gas_cfg.heat_rates if h.key == "combined_cycle"),
              None) if gas_cfg else None
    return {"window_days": HUB_WINDOW_DAYS,
            "henry_hub": spot, "futures": futures(conn, spot), "outlook": fwd,
            "history": history(conn), "storage": storage(conn), "demand": dem,
            "cc_mmbtu_per_mwh": cc,
            "power_vs_gas": power_vs_gas(conn, power_cfg, cc),
            "fuel_cost": fuel_cost(gas_cfg, spot, fwd),
            "ai_gas_deals": ai_gas_deals(deals_cfg, gas_cfg, dem)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "gas.json")
