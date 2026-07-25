"""Market-resolution construction labor — pure aggregation stage.

Three rules make this correct, and all three are load-bearing:

1. Wage is EMPLOYMENT-WEIGHTED across a market's counties, never a simple
   mean — Loudoun (26k construction workers) must not be averaged 50/50 with
   a 500-worker neighbour.
2. The wage weight is AVERAGE MONTHLY employment (`aemp`, (m1+m2+m3)/3),
   never the month3 point-in-time headcount (`emp`) — established
   empirically: total_qtrly_wages/aemp/13 reproduces BLS's own published
   avg_wkly_wage within integer rounding for 100% of county-quarters, vs
   ~2-3% for a month3 denominator. `emp` (month3) is kept ONLY for the
   displayed headcount: `emp`, `emp_yoy_pct`, and `emp_cur_total` are month3
   sums and never touch `aemp` — the two employment bases are deliberately
   different numbers serving different roles, not a rounding nuance.
3. YoY uses a LIKE-FOR-LIKE county set: a county missing or disclosure-
   suppressed in either quarter is excluded from BOTH sides of the ratio,
   or composition change contaminates the rate. Same discipline as
   dcindex.py:192-195 for Louisiana's flickering state-level suppression.
   A market only falls back to a current-quarter-only set (YoY -> None)
   when NO county clears the like-for-like bar -- with nothing to compare,
   there is no ratio left to contaminate, so a market with full current
   data still publishes a level instead of reading as unavailable.

Two regimes, and the payload says which one it's in, per row:

- `yoy_basis == "like_for_like"`: `counties_used`/`counties`/`wage`/`emp`
  cover the subset with BOTH quarters present -- the set the YoY ratio is
  computed over. `wage_yoy_pct`/`emp_yoy_pct` may still be None (e.g. a
  zero-weight base quarter), but the counties they WOULD be computed over
  are the ones counted here.
- `yoy_basis is None`: no county cleared the like-for-like bar, so
  `counties_used`/`counties`/`wage`/`emp` fall back to covering the
  current-quarter-only set instead. There is no ratio in this regime, ever.

`counties_used` and `counties_suppressed` change which set they're counting
across these two regimes -- `yoy_basis` is the explicit marker a consumer
(Task 7's writer, the site) must check before interpreting them, since
`wage_yoy_pct is None` alone is ambiguous (it's also what a zero-weight
denominator inside the like-for-like regime looks like).

`wage_cur`/`emp_cur_total` are additive, NOT regime-dependent: they are
always the employment-weighted wage and total employment across every
county with CURRENT-quarter data (`cur_usable`), independent of whether
those counties survived last year's disclosure. `thin_base` is evaluated
against `emp_cur_total`, never against the (possibly like-for-like-
truncated) `emp` -- a market must never read as thin merely because its
biggest county happened to be base-quarter-suppressed, and must never
read as NOT thin because a truncated survivor set looked big enough.

`counties_suppressed` covers any county that isn't in the regime's `usable`
set for any reason -- genuinely disclosure-suppressed, present in only one
of the two quarters, or missing entirely. It does not distinguish why.

Markets whose counties are all suppressed degrade to available=False and
stay in the roster — a visible hole, never a silent drop or a 0.
`available` is only set True once a wage level actually resolves (a
zero-total-employment county set still has `usable` counties but no
computable weighted mean, and must not be reported as available)."""

from pipeline.dc_markets import MarketSpec

THIN_BASE = 1500  # construction workers; below this a YoY is real but noisy
                  # (Richland Parish is 563) and must be labelled as such


def _year_ago(obs_date: str) -> str:
    return f"{int(obs_date[:4]) - 1}{obs_date[4:]}"


def _pct(cur: float | None, base: float | None) -> float | None:
    if cur is None or not base:
        return None
    return round((cur / base - 1) * 100, 1)


def _weighted(pairs: list[tuple[float, float]]) -> float | None:
    """[(value, weight)] -> weighted mean, None if no weight."""
    den = sum(w for _, w in pairs)
    if not den:
        return None
    return sum(v * w for v, w in pairs) / den


def market_rows(wage: dict[str, dict[str, float]],
                emp: dict[str, dict[str, float]],
                aemp: dict[str, dict[str, float]],
                markets: tuple[MarketSpec, ...],
                national_wage: dict[str, float],
                national_emp: dict[str, float],
                thin_base: int = THIN_BASE) -> dict:
    as_of = max(national_wage) if national_wage else None
    base_date = _year_ago(as_of) if as_of else None

    nat_w = national_wage.get(as_of) if as_of else None
    nat_w_base = national_wage.get(base_date) if base_date else None
    nat_e = national_emp.get(as_of) if as_of else None
    nat_e_base = national_emp.get(base_date) if base_date else None
    nat_w_yoy = _pct(nat_w, nat_w_base)
    nat_e_yoy = _pct(nat_e, nat_e_base)

    rows = []
    for m in markets:
        # a county needs wage, emp, AND aemp for the CURRENT quarter just to
        # be counted at all -- this is the true, undiscounted current
        # market: wage_cur/emp_cur_total below are computed over this set,
        # never the (possibly YoY-truncated) usable set. In practice aemp's
        # presence always mirrors emp's (the connector emits both from the
        # same row under the same suppression gate), but the check is
        # explicit rather than assumed.
        cur_usable = [f for f in m.counties
                      if as_of and wage.get(f, {}).get(as_of) is not None
                      and emp.get(f, {}).get(as_of) is not None
                      and aemp.get(f, {}).get(as_of) is not None]
        # like-for-like: prefer the subset that ALSO has all three series in
        # the BASE quarter, so the reported level/YoY share one composition
        # (a county present only in the current quarter would otherwise
        # inflate the level without inflating the comparison base). If no
        # county in the market clears that bar there is no ratio to
        # contaminate -- YoY degrades to None rather than nuking a market
        # that has full current-quarter data down to unavailable.
        yoy_usable = [f for f in cur_usable
                      if base_date and wage.get(f, {}).get(base_date) is not None
                      and emp.get(f, {}).get(base_date) is not None
                      and aemp.get(f, {}).get(base_date) is not None]
        usable = yoy_usable if yoy_usable else cur_usable
        have_yoy = bool(yoy_usable)
        # a county not in `usable` is "suppressed" here whether it's
        # genuinely disclosure-suppressed, present in only one of the two
        # quarters, or missing entirely -- this field doesn't distinguish
        # why, only that it can't contribute to whichever regime `usable`
        # landed on.
        suppressed = [f for f in m.counties if f not in usable]

        row = {"key": m.key, "name": m.name, "state": m.state, "iso": m.iso,
               "grid": m.grid, "utility": m.utility, "note": m.note,
               "counties_total": len(m.counties), "counties_used": len(usable),
               "counties_suppressed": suppressed,
               "as_of": as_of, "base_date": base_date,
               "yoy_basis": "like_for_like" if have_yoy else None,
               "available": False, "thin_base": False,
               "wage": None, "wage_yoy_pct": None, "wage_spread_pp": None,
               "emp": None, "emp_yoy_pct": None, "emp_spread_pp": None,
               "wage_cur": None, "emp_cur_total": None,
               "counties": []}

        for f in usable:
            row["counties"].append({
                "fips": f,
                "wage": round(wage[f][as_of], 2),
                "emp": int(emp[f][as_of]),
                "wage_yoy_pct": _pct(wage[f][as_of], wage[f].get(base_date))
                                if have_yoy else None,
                "emp_yoy_pct": _pct(emp[f][as_of], emp[f].get(base_date))
                               if have_yoy else None})

        # true current-quarter market size, independent of whether last
        # year's data survived disclosure -- thin_base MUST use this, never
        # the (possibly like-for-like-truncated) usable-set employment.
        # wage_cur is weighted by aemp (average monthly employment);
        # emp_cur_total stays a month3 sum -- the two employment bases are
        # deliberately different (see the module docstring).
        if cur_usable:
            w_cur_total = _weighted(
                [(wage[f][as_of], aemp[f][as_of]) for f in cur_usable])
            e_cur_total = sum(emp[f][as_of] for f in cur_usable)
            if w_cur_total is not None:
                row["wage_cur"] = round(w_cur_total, 2)
            row["emp_cur_total"] = int(e_cur_total)
            row["thin_base"] = row["emp_cur_total"] < thin_base

        if usable:
            w_cur = _weighted([(wage[f][as_of], aemp[f][as_of]) for f in usable])
            e_cur = sum(emp[f][as_of] for f in usable)
            if w_cur is not None:
                row["wage"] = round(w_cur, 2)
                row["emp"] = int(e_cur)
                row["available"] = True
            if have_yoy and w_cur is not None:
                w_base = _weighted([(wage[f][base_date], aemp[f][base_date])
                                    for f in usable])
                e_base = sum(emp[f][base_date] for f in usable)
                row["wage_yoy_pct"] = _pct(w_cur, w_base)
                row["emp_yoy_pct"] = _pct(e_cur, e_base)
                if row["wage_yoy_pct"] is not None and nat_w_yoy is not None:
                    row["wage_spread_pp"] = round(row["wage_yoy_pct"] - nat_w_yoy, 1)
                if row["emp_yoy_pct"] is not None and nat_e_yoy is not None:
                    row["emp_spread_pp"] = round(row["emp_yoy_pct"] - nat_e_yoy, 1)
        rows.append(row)

    return {"as_of": as_of, "base_date": base_date,
            "national": {"wage": nat_w, "wage_yoy_pct": nat_w_yoy,
                         "emp": int(nat_e) if nat_e is not None else None,
                         "emp_yoy_pct": nat_e_yoy, "as_of": as_of},
            "markets": rows}
