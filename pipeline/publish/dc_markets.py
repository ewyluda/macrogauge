"""Writer for dc_markets.json — the /markets DC market panel.

County QCEW wage + employment (tight core counties per market) against the
national NAICS-23 baseline, plus a DENOMINATED capacity-competition column.

The capacity join publishes four numbers, never one: sites, disclosed MW,
sites whose MW is undisclosed, and (site-wide) the geo_unmapped total. A bare
MW figure would read as authoritative when capacity.json is a 29-public-
company roster covering ~40% of its own tracked MW — private operators and
hyperscaler leased space are not in it. Membership is by hand-assigned market
tag, never a coordinate radius: 70 of 112 geo entries are approx-placed and
the flag does not identify which coordinates are trustworthy.

ALL derived math lives here and in engine/dcmarkets.py; the site renders
only."""
from pathlib import Path

from pipeline.engine import dcmarkets
from pipeline.publish.util import write_json

COVERAGE_NOTE = (
    "Competition MW is drawn from the /capacity tracker: 29 public companies, "
    "hand-curated from filings. Private operators (CyrusOne, Vantage, Aligned, "
    "STACK, QTS, EdgeConneX) and hyperscaler leased space inside their shells "
    "are not tracked, and sites with undisclosed locations carry no market. "
    "Treat it as a floor on what is in flight, never a census.")


def _series(conn, code: str) -> dict[str, float]:
    """{obs_date: value} for one series, latest vintage wins."""
    rows = conn.execute(
        "SELECT obs_date, value FROM observations WHERE series_code = ? "
        "ORDER BY vintage_date", (code,)).fetchall()
    return {d: v for d, v in rows}


def build(conn, markets, cap_cfg: dict, meta: dict) -> dict:
    counties = {f for m in markets for f in m.counties}
    wage = {f: _series(conn, f"qcew_wage23_c{f}") for f in counties}
    emp = {f: _series(conn, f"qcew_emp23_c{f}") for f in counties}
    wage = {f: v for f, v in wage.items() if v}
    emp = {f: v for f, v in emp.items() if v}

    payload = dcmarkets.market_rows(
        wage, emp, markets,
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
        row["mw_disclosed"] = int(sum(g["mw"] for g in sites if g.get("mw")))
        row["sites_mw_undisclosed"] = sum(1 for g in sites if not g.get("mw"))

    return {**payload, "as_of_curated": meta["as_of_curated"],
            "note": meta["note"], "coverage_note": COVERAGE_NOTE}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "dc_markets.json")
