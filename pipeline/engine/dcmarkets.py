"""Market-resolution construction labor — pure aggregation stage.

Two rules make this correct, and both are load-bearing:

1. Wage is EMPLOYMENT-WEIGHTED across a market's counties, never a simple
   mean — Loudoun (26k construction workers) must not be averaged 50/50 with
   a 500-worker neighbour.
2. YoY uses a LIKE-FOR-LIKE county set: a county missing or disclosure-
   suppressed in either quarter is excluded from BOTH sides of the ratio,
   or composition change contaminates the rate. Same discipline as
   dcindex.py:192-195 for Louisiana's flickering state-level suppression.
   A market only falls back to a current-quarter-only set (YoY -> None)
   when NO county clears the like-for-like bar -- with nothing to compare,
   there is no ratio left to contaminate, so a market with full current
   data still publishes a level instead of reading as unavailable.

Markets whose counties are all suppressed degrade to available=False and
stay in the roster — a visible hole, never a silent drop or a 0."""

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
        # a county needs both wage and emp for the CURRENT quarter just to
        # be counted at all
        cur_usable = [f for f in m.counties
                      if as_of and wage.get(f, {}).get(as_of) is not None
                      and emp.get(f, {}).get(as_of) is not None]
        # like-for-like: prefer the subset that ALSO has both series in the
        # BASE quarter, so the level we publish shares its composition with
        # the YoY ratio (a county present only in the current quarter would
        # otherwise inflate the level without inflating the comparison base).
        # If no county in the market clears that bar there is no ratio to
        # contaminate -- YoY degrades to None rather than nuking a market
        # that has full current-quarter data down to unavailable.
        yoy_usable = [f for f in cur_usable
                      if base_date and wage.get(f, {}).get(base_date) is not None
                      and emp.get(f, {}).get(base_date) is not None]
        usable = yoy_usable if yoy_usable else cur_usable
        have_yoy = bool(yoy_usable)
        suppressed = [f for f in m.counties if f not in usable]

        row = {"key": m.key, "name": m.name, "state": m.state, "iso": m.iso,
               "grid": m.grid, "utility": m.utility, "note": m.note,
               "counties_total": len(m.counties), "counties_used": len(usable),
               "counties_suppressed": suppressed,
               "as_of": as_of, "base_date": base_date,
               "available": bool(usable), "thin_base": False,
               "wage": None, "wage_yoy_pct": None, "wage_spread_pp": None,
               "emp": None, "emp_yoy_pct": None, "emp_spread_pp": None,
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

        if usable:
            w_cur = _weighted([(wage[f][as_of], emp[f][as_of]) for f in usable])
            e_cur = sum(emp[f][as_of] for f in usable)
            if w_cur is not None:
                row["wage"] = round(w_cur, 2)
                row["emp"] = int(e_cur)
                row["thin_base"] = e_cur < thin_base
            if have_yoy and w_cur is not None:
                w_base = _weighted([(wage[f][base_date], emp[f][base_date])
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
