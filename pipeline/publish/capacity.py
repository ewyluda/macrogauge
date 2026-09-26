"""Writer for capacity.json — the /capacity AI-megawatts tracker.

Hand-curated MW layer (config/capacity.json) x daily FMP_EQ market caps from
the store. ALL derived analytics live here (the site renders only): EV = cap +
net debt; weighted MW = op + 0.5*con + 0.25*plan; EV/MW in $M/MW — published
null for hyperscaler-role and private rows where a conglomerate EV over an
AI-DC slice would mislead; %energized; coverage = backlog / EV. The energization
timeline dates each construction site by its curated `energize_q` (5th sites
element) and falls back to parsing the free-text `when` (parse_quarter).
A missing quote degrades the row (cap null, stale true) — never drops it; a
carried-forward quote older than the registry staleness limit keeps its value
(and priced_date) but flags stale so the page can label it."""
import re
from datetime import date
from pathlib import Path

from pipeline.capacity import cap_series, px_series
from pipeline.publish.util import write_json
from pipeline.store import vintage

_Y = r"(?<!\d)(20(?:2[5-9]|3\d))(?!\d)"          # 2025-2039
_MON = {"jan": 1, "feb": 1, "mar": 1, "apr": 2, "may": 2, "jun": 2,
        "jul": 3, "aug": 3, "sep": 3, "oct": 4, "nov": 4, "dec": 4}
_MON_RE = (r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|"
           r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
           r"dec(?:ember)?)\b\.?")
_POS = {"early": 1, "spring": 2, "mid": 2, "midyear": 2, "summer": 3,
        "late": 4, "fall": 4, "autumn": 4, "end": 4, "ye": 4, "year-end": 4}
# Milestone tokens, most specific first; each maps a match to (year, quarter).
# Every token pairs the year with a quarter/half/month/position word DIRECTLY
# adjacent to it — a keyword elsewhere in the string never assigns a quarter.
# A period coarser than a quarter resolves to its LAST quarter (1H -> Q2,
# 2H -> Q4, bare year -> Q4): the conservative reading, and the long-standing
# bare-year default.
_TOKENS = [
    (re.compile(_Y + r"-(\d{2})-\d{2}"),                       # ISO date
     lambda m: (int(m[1]), (int(m[2]) - 1) // 3 + 1 if 1 <= int(m[2]) <= 12 else 4)),
    (re.compile(r"\bq([1-4])\s*'(\d{2})(?!\d)"),               # Q1'26
     lambda m: (2000 + int(m[2]), int(m[1]))),
    (re.compile(r"\bq([1-4])[\s-]*" + _Y),                     # Q4 2026
     lambda m: (int(m[2]), int(m[1]))),
    (re.compile(_Y + r"[\s-]*q([1-4])\b"),                     # 2027 Q1
     lambda m: (int(m[1]), int(m[2]))),
    (re.compile(r"\b(?:([12])h|h([12]))[\s-]*" + _Y),          # 1H 2028 / H2 2026
     lambda m: (int(m[3]), 2 if (m[1] or m[2]) == "1" else 4)),
    (re.compile(_Y + r"[\s-]*(?:([12])h|h([12]))\b"),          # 2026 H2
     lambda m: (int(m[1]), 2 if (m[2] or m[3]) == "1" else 4)),
    (re.compile(r"\b" + _MON_RE + r"[\s-]*" + _Y),             # Aug 2026, Oct-2025
     lambda m: (int(m[2]), _MON[m[1][:3]])),
    (re.compile(r"\b(early|spring|midyear|mid|summer|late|fall|autumn|"
                r"year-end|end|ye)[\s-]*~?" + _Y),             # early 2028, YE 2026
     lambda m: (int(m[2]), _POS[m[1]])),
    (re.compile(_Y), lambda m: (int(m[1]), 4)),                # bare year
]
# Clause tiers: a clause naming first power / delivery / operations outranks
# a neutral one, which outranks a deal / construction-start milestone. "full"
# / "completion" are deliberately NOT first-power words: "1H 2027 - 1H 2028;
# full 530 MW by end-2028" energizes in 1H 2027, not at full build-out.
_ENERGIZE = re.compile(
    r"deliver|energi[sz]|online|on-line|\blive\b|\bops\b|operat|power|\bfirst\b|"
    r"initial|data hall|\brev\b|revenue|\brent\b|ramp|ready|in service")
_NOT_ENERGIZE = re.compile(
    r"announc|\bann\.|signed|\bsign\b|closed|\bclose\b|began|begin|broke ground|"
    r"groundbreak|construct|\bconstr\b|foundation|advanced to|launched|expanding")


def _milestones(clause: str) -> list[int]:
    out, s = [], clause
    for rx, fn in _TOKENS:
        for m in rx.finditer(s):
            year, q = fn(m)
            if 2025 <= year <= 2039:
                out.append(year * 4 + (q - 1))
        s = rx.sub(lambda m: " " * len(m[0]), s)   # consume: no double reads
    return out


def parse_quarter(when: str | None) -> int | None:
    """Free-text site 'when' -> quarter ordinal (year*4 + q-1); None if undated.

    FALLBACK only: a curated `energize_q` on the site row wins (site_quarter).
    Rule, in order:
      1. parentheticals are dropped — "(2 mo early)", "(slipped from Q3)",
         "(was Q4 2026)" annotate a date, they never are the date;
      2. split into clauses on ';' and ',';
      3. read milestone tokens per clause (_TOKENS: year + ADJACENT quarter /
         half / month / position word; years 2025-2039);
      4. keep the highest non-empty tier — clauses naming energization /
         delivery / operations, then neutral clauses, then deal or
         construction-start clauses ("signed Aug 2026", "closed 2026-08-14",
         "construction began Oct-2025");
      5. take the EARLIEST milestone in that tier (first power, not full
         build-out)."""
    s = re.sub(r"\([^)]*\)", " ", (when or "").lower())
    tiers: dict[int, list[int]] = {}
    for clause in re.split(r"[;,]", s):
        ms = _milestones(clause)
        if not ms:
            continue
        tier = (0 if _ENERGIZE.search(clause)
                else 2 if _NOT_ENERGIZE.search(clause) else 1)
        tiers.setdefault(tier, []).extend(ms)
    return min(tiers[min(tiers)]) if tiers else None


_ENERGIZE_Q = re.compile(r"^(\d{4})Q([1-4])$")


def site_quarter(site: list) -> int | None:
    """Quarter ordinal for a sites row [name, mw, st, when(, energize_q)]:
    the curated energize_q ("2027Q4", or null = deliberately undated) when the
    row carries one, else the free-text fallback parse of `when`."""
    if len(site) >= 5:
        eq = site[4]
        if eq is None:
            return None
        m = _ENERGIZE_Q.match(eq)
        return int(m[1]) * 4 + int(m[2]) - 1
    return parse_quarter(site[3])


def _quarter_label(o: int) -> str:
    return f"{o // 4}Q{o % 4 + 1}"


def _ordinal(label: str) -> int:
    return int(label[:4]) * 4 + int(label[5]) - 1


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
            # published sites keep the [name, mw, st, when] shape the page
            # destructures; the curated energize_q surfaces through `tl`
            "sites": [list(s[:4]) for s in c["sites"]],
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
    `tl` field (client-side filtered timelines) and the cohort `timeline`
    (which reads it back from `tl`). Quarter = site_quarter(): curated
    energize_q first, free-text fallback second."""
    out = []
    for site in sites:
        name, mw, st = site[0], site[1], site[2]
        if st != "c" or not mw:
            continue
        o = site_quarter(site)
        if o is not None and o >= _QMIN:
            out.append((o, name, mw))
    return out


def _timeline(rows: list[dict]) -> dict:
    live = [r for r in rows if r["dupe"] is None]
    base = sum(r["op"] for r in live)
    adds: dict[int, float] = {}
    miles: dict[int, list] = {}
    for r in live:
        for label, name, mw in r["tl"]:
            o = _ordinal(label)
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
    # Only rows that publish an EV/MW: a hyperscaler's conglomerate EV (or a
    # private builder's) is the very number the rows themselves suppress as
    # misleading over an AI-DC slice — summing it here made "combined tracked
    # EV" ~97% MSFT/GOOGL/AMZN/META (2026-09: $14.0T with them, $0.38T
    # without).
    evs = [r["ev"] for r in rows
           if r["ev"] is not None and r["dupe"] is None
           and r["ev_per_mw"] is not None]
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
