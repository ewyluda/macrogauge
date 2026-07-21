"""Writer for capacity.json — the /capacity AI-megawatts tracker.

Hand-curated MW layer (config/capacity.json) x daily FMP_EQ market caps from
the store. ALL derived analytics live here (the site renders only): EV = cap +
net debt; weighted MW = op + 0.5*con + 0.25*plan; EV/MW in $M/MW — published
null for hyperscaler-role and private rows where a conglomerate EV over an
AI-DC slice would mislead; %energized; coverage = backlog / EV. The notebook
tracker's render-time quarter parsing (energization timeline) is ported here.
A missing quote degrades the row (cap null, stale true) — never drops it; a
carried-forward quote older than the registry staleness limit keeps its value
(and priced_date) but flags stale so the page can label it."""
import re
from datetime import date
from pathlib import Path

from pipeline.capacity import cap_series, px_series
from pipeline.publish.util import write_json
from pipeline.store import vintage

_YEAR = re.compile(r"20(2[5-9])")


def parse_quarter(when: str | None) -> int | None:
    """Site 'when' string -> quarter ordinal (year*4 + q-1), None if undated.
    Semantics ported verbatim from the notebook tracker's parseQ()."""
    s = (when or "").lower()
    m = _YEAR.search(s)
    if not m:
        return None
    year = int("20" + m.group(1))
    if re.search(r"q1|jan|feb|march|\bmar\b|early", s):
        q = 1
    elif re.search(r"q2|apr|may|jun|mid-?2|midyear|mid ", s):
        q = 2
    elif re.search(r"q3|jul|aug|sep", s):
        q = 3
    else:
        q = 4
    return year * 4 + (q - 1)


def _quarter_label(o: int) -> str:
    return f"{o // 4}Q{o % 4 + 1}"


def _latest(conn, code):
    rows = vintage.latest(conn, code)
    return (rows[-1][0], rows[-1][1]) if rows else (None, None)


_PASSTHROUGH = ("t", "n", "role", "dupe", "private", "confidence", "flag",
                "dom", "pipe", "op", "con", "plan", "nd", "ndflag", "bk",
                "valuation_b", "econ", "sites", "src")


def _company_row(conn, c: dict, today: str | None = None,
                 staleness: dict[str, int] | None = None) -> dict:
    private = c["private"]
    cap_date = cap = px = None
    if not private:
        cap_date, cap = _latest(conn, cap_series(c["t"]))
        _, px = _latest(conn, px_series(c["t"]))
    total = c["op"] + c["con"] + c["plan"]
    wmw = c["op"] + 0.5 * c["con"] + 0.25 * c["plan"]
    ev = round(cap + (c.get("nd") or 0), 2) if cap is not None else None
    suppress = private or c["role"] == "hyperscaler"
    # Carry-forward semantics make an old quote harmless, but never fresh:
    # the row keeps its value + priced_date and flags stale once the quote
    # ages past the registry limit for its fmp_cap_* series.
    aged = (today is not None and cap_date is not None and
            (date.fromisoformat(today) - date.fromisoformat(cap_date)).days
            > (staleness or {}).get(cap_series(c["t"]), 7))
    return {**{k: c.get(k) for k in _PASSTHROUGH},
            "cap": round(cap, 2) if cap is not None else None,
            "px": px, "priced_date": cap_date,
            "stale": not private and (cap is None or aged),
            "tl": [[_quarter_label(o), name, mw]
                   for o, name, mw in _events(c["sites"])],
            "ev": ev, "wmw": round(wmw, 1),
            "ev_per_mw": (round(ev * 1000 / wmw, 1)
                          if ev is not None and wmw > 0 and not suppress else None),
            "pct_energized": round(100 * c["op"] / total, 1) if total > 0 else None,
            "coverage": (round(c["bk"] / ev, 2) if c.get("bk") is not None and ev else None)}


def _cohort(row: dict) -> str:
    return "hyperscaler" if row["role"] == "hyperscaler" else "neocloud"


def _totals(rows: list[dict]) -> dict:
    live = [r for r in rows if r["dupe"] is None]
    return {"companies": len(rows),
            "op": sum(r["op"] for r in live),
            "con": sum(r["con"] for r in live),
            "plan": sum(r["plan"] for r in live)}


# The original tracker's timeline window opens at 2026Q2; earlier or undated
# construction sites are excluded from the curve entirely (they are NOT folded
# into base_mw, which is operational MW only — the on-site caption flags the
# resulting understatement).
_QMIN = 2026 * 4 + 1


def _events(sites: list) -> list[tuple[int, str, float]]:
    """Dated construction events inside the timeline window: (ordinal, site,
    mw). Single source of the st/mw/window filter for both the per-company
    `tl` field (client-side filtered timelines) and the cohort `timeline`."""
    out = []
    for name, mw, st, when in sites:
        if st != "c" or not mw:
            continue
        o = parse_quarter(when)
        if o is not None and o >= _QMIN:
            out.append((o, name, mw))
    return out


def _timeline(rows: list[dict]) -> dict:
    live = [r for r in rows if r["dupe"] is None]
    base = sum(r["op"] for r in live)
    adds: dict[int, float] = {}
    miles: dict[int, list] = {}
    for r in live:
        for o, name, mw in _events(r["sites"]):
            adds[o] = adds.get(o, 0) + mw
            miles.setdefault(o, []).append([r["t"], name, mw])
    if not adds:
        return {"base_mw": base, "points": [], "milestones": {}}
    points, cum = [], base
    for o in range(_QMIN, max(adds) + 1):
        cum += adds.get(o, 0)
        points.append({"q": _quarter_label(o), "add_mw": adds.get(o, 0),
                       "cum_mw": cum})
    return {"base_mw": base, "points": points,
            "milestones": {_quarter_label(o): m for o, m in sorted(miles.items())}}


def build(conn, cfg: dict, today: str | None = None,
          staleness: dict[str, int] | None = None) -> dict:
    rows = [_company_row(conn, c, today, staleness) for c in cfg["companies"]]
    neo = [r for r in rows if _cohort(r) == "neocloud"]
    hyp = [r for r in rows if _cohort(r) == "hyperscaler"]
    priced = [r["priced_date"] for r in rows if r["priced_date"]]
    _, nvda_cap = _latest(conn, "fmp_cap_nvda")
    evs = [r["ev"] for r in rows if r["ev"] is not None and r["dupe"] is None]
    return {"as_of_curated": cfg["as_of_curated"],
            "priced_date": max(priced) if priced else None,
            "note": cfg["note"], "basis": cfg["basis"],
            "companies": rows,
            "cohorts": {"all": _totals(rows), "neocloud": _totals(neo),
                        "hyperscaler": _totals(hyp)},
            "timeline": {"all": _timeline(rows), "neocloud": _timeline(neo),
                         "hyperscaler": _timeline(hyp)},
            "tenants": cfg["tenants"], "geo": cfg["geo"],
            "geo_unmapped": cfg["geo_unmapped"], "geo_note": cfg["geo_note"],
            "reference": {"nvda_cap_b": round(nvda_cap, 1) if nvda_cap is not None else None,
                          "cohort_ev_b": round(sum(evs), 1) if evs else None}}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "capacity.json")
