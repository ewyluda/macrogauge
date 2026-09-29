"""Writer for compare.json — monthly ours-vs-official YoY + validation stats.

The validation block carries the Phase-1 exit criterion (tracker Pearson corr
vs official >= 0.95 on the 2018-now backfill); 1c's methodology page reads it
from here.
"""
import statistics
from datetime import date
from pathlib import Path

from pipeline.engine import realtime
from pipeline.engine.gauge import PUBLISH_START
from pipeline.publish.util import write_json
from pipeline.store import vintage


def _official_yoy(conn, code: str = "CPIAUCNS") -> dict[str, float]:
    series = dict(vintage.latest(conn, code))
    out = {}
    for m, v in series.items():
        base = f"{int(m[:4]) - 1:04d}-{m[5:7]}-01"
        if base in series:
            out[m] = (v / series[base] - 1) * 100
    return out


# supercore grades against BLS "services less rent of shelter" (NSA, like the
# gauge) from 2026-09-28 — until then core CPI, which is ~44% shelter and
# ~25% core goods: the wrong target for a services-ex-shelter cut.
SUPERCORE_REF = "CUUR0000SASL2RS"
GRADE_REF = {"gauge": "CPIAUCNS", "col": "CPIAUCNS", "tracker": "CPIAUCNS",
             "supercore": SUPERCORE_REF, "pce": "PCEPI"}


def _validation(official: list[float | None], ours: list[float | None]) -> dict:
    # official can itself carry Nones here (e.g. pce grades against PCEPI,
    # which has no store rows until the next collect -- _official_yoy then
    # returns {} and every element of `official` is None). Filtering both
    # sides means an empty/partial grading series degrades to the same
    # "no pairs" path as a genuinely short window: corr/mag both None.
    pairs = [(o, s) for o, s in zip(official, ours) if o is not None and s is not None]
    corr = mag = None
    if pairs:
        xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
        mag = round(sum(abs(x - y) for x, y in zip(xs, ys)) / len(xs), 2)
        if len(pairs) >= 2:
            try:
                corr = round(statistics.correlation(xs, ys), 4)
            except statistics.StatisticsError:  # zero variance
                corr = None
    return {"corr": corr, "mean_abs_gap_pp": mag}


def _month_add(m: str, k: int) -> str:
    y, mo = int(m[:4]), int(m[5:7]) + k
    return f"{y + (mo - 1) // 12:04d}-{(mo - 1) % 12 + 1:02d}-01"


def _lead_lag(official: dict[str, float], ours: dict[str, float | None],
              max_shift: int = 6) -> dict | None:
    """Best Pearson corr of ours[m] vs official m+k months ahead (k=0..6).
    The gauge sees market prices before they reach the print — this is the
    hero-callout credibility stat (1c spec §5.2). Pairing is by CALENDAR
    month, never list position: the official months list has a hole (the
    never-published 2025-10 shutdown print), so a positional k=1 silently
    became a 2-calendar-month shift across it."""
    best = None
    for k in range(max_shift + 1):
        pairs = [(v, official[_month_add(m, k)]) for m, v in ours.items()
                 if v is not None and _month_add(m, k) in official]
        if len(pairs) < 2:
            continue
        xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
        try:
            c = statistics.correlation(xs, ys)
        except statistics.StatisticsError:  # zero variance
            continue
        if best is None or c > best[1]:
            best = (k, c)
    return (None if best is None
            else {"best_shift_months": best[0], "corr": round(best[1], 4)})


def build(gauge_result: dict, conn, ledger_rows: list[dict] | None = None) -> dict:
    """`ledger_rows` (store/ledger/pulse.jsonl, via ledger.read_rows) feed
    the vintage-true `realtime` track where the ledger covers a month-end."""
    off = _official_yoy(conn)
    months = [m for m in sorted(off) if m >= PUBLISH_START]
    official_col = [round(off[m], 2) for m in months]
    core = _official_yoy(conn, "CPILFENS")
    core_col = [None if m not in core else round(core[m], 2) for m in months]
    # Official PCE price index on the same month grid, so /pce can chart the
    # pce variant against what it is graded on (batch 2a, 2026-09-03). Null
    # where PCEPI has no store rows -- same degradation as the core column.
    pce = _official_yoy(conn, "PCEPI")
    pce_col = [None if m not in pce else round(pce[m], 2) for m in months]
    core_pce = _official_yoy(conn, "PCEPILFE")  # core PCE for /pce (2026-09-28)
    core_pce_col = [None if m not in core_pce else round(core_pce[m], 2) for m in months]
    svc = _official_yoy(conn, SUPERCORE_REF)  # supercore's reference series
    svc_col = [None if m not in svc else round(svc[m], 2) for m in months]
    payload = {"months": months, "official_yoy_pct": official_col,
               "official_core_yoy_pct": core_col,
               "official_pce_yoy_pct": pce_col,
               "official_core_pce_yoy_pct": core_pce_col,
               "official_supercore_yoy_pct": svc_col,
               "validation": {}}
    window = f"{months[0][:7]}..{months[-1][:7]}" if months else ""
    ref_yoy_cache: dict[str, dict[str, float]] = {"CPIAUCNS": off, "CPILFENS": core,
                                                  "PCEPI": pce, SUPERCORE_REF: svc}
    for name, v in gauge_result["variants"].items():
        # Sample each month at its LAST grid date — quilt.py's convention.
        # Month-first sampling published a different number for "our YoY in
        # month m" than the quilt cells in the same heatmap column (~0.5pp
        # on volatile months) and fed the month's least-informed value into
        # the validation stats.
        last_in_month: dict[str, str] = {}
        for d in sorted(v["yoy"]):
            last_in_month[f"{d[:7]}-01"] = d
        raw = [v["yoy"].get(last_in_month.get(m, m)) for m in months]
        payload[f"{name}_yoy_pct"] = [None if x is None else round(x, 2)
                                      for x in raw]
        # each variant grades against its own reference series (spec §9.7):
        # gauge/col/tracker vs headline CPI, supercore vs BLS services less
        # rent of shelter, pce vs
        # the official PCE price index. PCEPI has no store rows until the
        # next collect on a fresh basket — _official_yoy then returns {} and
        # ref_col is all-None, which _validation degrades to corr=mag=None
        # (the same "no pairs" path a too-short window takes), not a crash.
        ref_code = GRADE_REF.get(name, "CPIAUCNS")
        if ref_code not in ref_yoy_cache:
            ref_yoy_cache[ref_code] = _official_yoy(conn, ref_code)
        ref = ref_yoy_cache[ref_code]
        ref_col = [ref.get(m) for m in months]
        payload["validation"][name] = {
            **_validation(ref_col, raw), "window": window}
        if name == "gauge":
            payload["validation"][name]["lead_lag"] = _lead_lag(
                off, dict(zip(months, raw)))
    g = gauge_result["variants"].get("gauge") or {}
    comps_g = g.get("components") or {}
    if comps_g and all("obs_dates" in e for e in comps_g.values()):
        payload["realtime"] = _realtime(g, gauge_result.get("basket") or [],
                                        conn, months, off, ledger_rows, window)
    return payload


REALTIME_BASIS = (
    "Vintage-true: at each month-end, the gauge headline as it could have "
    "been known that day. Publish-ledger readings where they exist (since "
    "2026-07-08); before that a reconstruction that applies each official "
    "monthly print only from its first release date (CPI-U ALFRED vintages; "
    "component indexes release with the headline) and each live source only "
    "after its typical publication lag. Compare the hindsight series, which "
    "applies every monthly print from its reference month ~6 weeks early.")


def _realtime(g: dict, basket, conn, months: list[str],
              off: dict[str, float], ledger_rows: list[dict] | None,
              window: str) -> dict:
    """compare.json `realtime` block (backlog #2): the month-end vintage-true
    gauge track and its own validation stats vs official CPI."""
    release = {}
    for d, _, v in vintage.first_releases(conn, "CPIAUCNS"):
        lag = (date.fromisoformat(v) - date.fromisoformat(d)).days
        if 0 <= lag <= realtime.GENUINE_LAG_MAX_DAYS:  # a real release date
            release[d[:7]] = v
    lags: dict[str, int] = {}
    for c in basket:
        if not c.live_blend:
            continue
        lead = c.lead_days or {}
        lags[c.code] = max(
            max(0, realtime.typical_lag(vintage.first_releases(conn, s)) - lead.get(s, 0))
            for s in c.live_blend)
    tr = realtime.track(g, months, lags, release, ledger_rows)
    vals = tr["gauge_yoy_pct"]
    stats = {**_validation([off.get(m) for m in months], vals), "window": window,
             "lead_lag": _lead_lag(off, dict(zip(months, vals)))}
    return {**tr, "basis": REALTIME_BASIS,
            "lag_days": dict(sorted(lags.items())),
            "n_ledger": tr["source"].count("ledger"),
            "n_reconstructed": tr["source"].count("reconstructed"),
            "validation": stats}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "compare.json")
