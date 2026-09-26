"""Writer for dc_markets.json — the /markets DC market panel.

County QCEW wage + employment (tight core counties per market) against the
national NAICS-23 baseline, plus a DENOMINATED capacity-competition column.

The capacity join publishes four numbers, never one: sites, disclosed MW,
sites whose MW is undisclosed, and (site-wide) the coverage_note. A bare
MW figure would read as authoritative when capacity.json is a hand-curated
roster (public companies plus a few private builders) covering ~40% of its
own tracked MW — private operators and
hyperscaler leased space are not in it. Membership is by hand-assigned market
tag, never a coordinate radius: 70 of 112 geo entries are approx-placed and
the flag does not identify which coordinates are trustworthy.

ALL derived math lives here and in engine/dcmarkets.py; the site renders
only."""
from pathlib import Path

from pipeline.engine import dcmarkets
from pipeline.publish.util import write_json
from pipeline.store import vintage

def coverage_note(companies: list[dict]) -> str:
    """The site-wide coverage caveat. The roster size is COUNTED from the
    capacity config (it read "29 public companies" while two of the 29 --
    xAI and Stargate -- are private), so a curation change can't leave the
    sentence stale."""
    public = sum(1 for c in companies if not c.get("private"))
    private = [c["n"].split(" (")[0] for c in companies if c.get("private")]
    roster = f"{public} public {'company' if public == 1 else 'companies'}"
    if private:
        roster += (f" plus {len(private)} private "
                   f"builder{'' if len(private) == 1 else 's'} "
                   f"({', '.join(private)})")
    return _COVERAGE_NOTE.format(roster=roster)


_COVERAGE_NOTE = (
    "Competition MW is drawn from the /capacity tracker: {roster}, "
    "hand-curated from filings. Private operators (CyrusOne, Vantage, Aligned, "
    "STACK, QTS, EdgeConneX) and hyperscaler leased space inside their shells "
    "are not tracked, and sites with undisclosed locations carry no market. "
    "MW under construction counts only sites tagged st=\"c\" -- operating, "
    "planned and secured MW are published separately, never folded in -- so "
    "treat it as a floor on what is actually being built, never a census.")

# Per-status MW buckets, keyed the same way GeoMap.tsx's legend is: o =
# operational, c = construction, p = planned, s = secured. "In flight" means
# c only (pipeline/publish/capacity.py's _events() uses the same filter) --
# an operating campus is a completed draw on the labor pool, not a live one,
# and neither planned nor secured sites have crews on site yet either.
_STATUS_FIELD = {"c": "mw_construction", "p": "mw_planned",
                  "s": "mw_secured", "o": "mw_operating"}


def _series(conn, code: str) -> dict[str, float]:
    """{obs_date: value} for one series, latest vintage wins.

    Built on vintage.latest() (the same helper capacity.py's _latest() uses)
    rather than reimplementing the ORDER BY: latest() breaks same-vintage
    ties by rowid explicitly, which a bare `ORDER BY vintage_date` does not
    guarantee for two rows sharing a (series_code, obs_date, vintage_date)."""
    return dict(vintage.latest(conn, code))


def build(conn, markets, cap_cfg: dict, meta: dict) -> dict:
    counties = {f for m in markets for f in m.counties}
    wage = {f: _series(conn, f"qcew_wage23_c{f}") for f in counties}
    emp = {f: _series(conn, f"qcew_emp23_c{f}") for f in counties}
    # average monthly employment ((m1+m2+m3)/3) -- the wage weight
    # (dcmarkets.py), never the displayed headcount, which stays month3.
    aemp = {f: _series(conn, f"qcew_aemp23_c{f}") for f in counties}
    wage = {f: v for f, v in wage.items() if v}
    emp = {f: v for f, v in emp.items() if v}
    aemp = {f: v for f, v in aemp.items() if v}

    payload = dcmarkets.market_rows(
        wage, emp, aemp, markets,
        _series(conn, "qcew_wage23_us"), _series(conn, "qcew_emp23_us"))

    # capacity join by hand-assigned tag
    tagged: dict[str, list[dict]] = {}
    for g in cap_cfg["geo"]:
        key = g.get("market")
        if key:
            tagged.setdefault(key, []).append(g)
    for row in payload["markets"]:
        sites = tagged.get(row["key"], [])
        row["sites"] = len(sites)
        row["mw_disclosed"] = int(sum(g["mw"] for g in sites
                                      if g.get("mw") is not None))
        row["sites_mw_undisclosed"] = sum(1 for g in sites
                                          if g.get("mw") is None)
        buckets = {f: 0 for f in _STATUS_FIELD.values()}
        for g in sites:
            mw = g.get("mw")
            if mw is None:
                continue
            field = _STATUS_FIELD.get(g["st"])
            if field:
                buckets[field] += mw
        row.update({f: int(v) for f, v in buckets.items()})

    return {**payload, "as_of_curated": meta["as_of_curated"],
            "note": meta["note"], "coverage_note": coverage_note(cap_cfg.get("companies", []))}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "dc_markets.json")
