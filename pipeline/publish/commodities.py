"""Writer for commodities.json — grouped market prices with sparklines.

Display-only unlock of already-collected daily market series (never touches
the gauge engine); follows the matrix/labor writer contract. The AI BUILD-OUT
group is the page's hook: the inputs the AI datacenter build-out is bidding
for (copper, aluminum, DRAM, GPU-hours, wholesale power, natural gas) as one
cross-cutting basket — /datacenter owns the composed indexes; this page shows
the raw prices. YoY and 30-day change use the nearest-obs-within-±3d daily
convention (weekday-only collection, see publish.util.pct_change_daily). A
series with no store rows publishes a null row: a new writer must never be
able to take down the publish block.

Where a true YoY can't be computed — a series first collected under a year
ago (DDR5/DDR4 spot, the H100-hour) or a sparse history whose nearest
year-ago reading falls outside ±3 days (Wayback NAND) — the row carries
`chg_alt`: the change against the reading nearest a year back (within a
month), else against the first reading, with that reading's date in the
label. Never an unlabeled YoY. PJM capacity is the curated auction history
(config/dc_power.json, the /power page's source): one row per delivery year,
its change auction-to-auction.
"""
from datetime import date, timedelta
from pathlib import Path

from pipeline import dc_power
from pipeline.publish.util import pct_change_daily, write_json
from pipeline.store import vintage

SPARK_OBS = 60  # ~3 trading months of daily closes per sparkline
PJM_CAPACITY = "pjm_capacity"   # curated (dc_power), not a store series
ALT_WINDOW_DAYS = 31            # how far from a year back a dated stand-in may sit
_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _day(d: str) -> str:
    return f"{_MON[int(d[5:7]) - 1]} {int(d[8:10])}, {d[:4]}"


def _span(first: str, last: str) -> str:
    """The period a sparkline covers, from its own first and last dates — a
    daily series' 60 obs are ~3 months, a monthly PPI's are 5 years."""
    if first[:4] == last[:4]:
        return f"{_MON[int(first[5:7]) - 1]} {int(first[8:10])} – {_day(last)}"
    return f"{_MON[int(first[5:7]) - 1]} {first[:4]} – {_MON[int(last[5:7]) - 1]} {last[:4]}"


def _alt_change(obs: dict, as_of: str) -> dict | None:
    """A dated stand-in for a missing YoY: vs the reading nearest a year back
    (within ALT_WINDOW_DAYS), else vs the first reading."""
    target = date.fromisoformat(as_of) - timedelta(days=365)
    older = [d for d in obs if d < as_of and obs[d]]
    if not older:
        return None
    near = min(older, key=lambda d: abs((date.fromisoformat(d) - target).days))
    base, label = ((near, f"vs {_day(near)}")
                   if abs((date.fromisoformat(near) - target).days) <= ALT_WINDOW_DAYS
                   else (min(older), f"since {_day(min(older))}"))
    return {"pct": round((obs[as_of] / obs[base] - 1) * 100, 2), "label": label}

# (code, label, unit) per group; group order is pinned by tests.
GROUPS = [
    ("AI BUILD INPUTS", [
        ("fmp_copper", "Copper front month", "$/lb"),
        ("fmp_alum", "Aluminum front month", "$/ton"),
        ("ppi_steel", "Steel mill products (PPI)", "index"),
        ("dramex_ddr5_16g", "DDR5 16Gb spot", "$"),
        ("dramex_ddr4_16g", "DDR4 16Gb spot", "$"),
        ("dramex_nand_mlc64", "NAND 64Gb spot", "$"),
        ("vast_h100_sxm", "H100 SXM (vast.ai median)", "$/GPU-hr"),
        ("caiso_sp15_da", "CAISO SP15 day-ahead", "$/MWh"),
        ("ice_pjm_west", "PJM Western Hub", "$/MWh"),
        (PJM_CAPACITY, "PJM capacity, auction clearing", "$/MW-day"),
    ]),
    ("ENERGY & POWER", [
        ("fmp_wti", "WTI crude front month", "$/bbl"),
        ("fmp_rbob", "RBOB gasoline front month", "$/gal"),
        ("fmp_natgas", "Nat gas futures front month", "$/MMBtu"),
        ("eia_henry_hub", "Henry Hub spot", "$/MMBtu"),
        ("miso_indiana_da", "MISO Indiana Hub DA", "$/MWh"),
    ]),
    # copper and aluminum live once, in the build-inputs group
    ("PRECIOUS METALS", [
        ("fmp_gold", "Gold front month", "$/oz"),
    ]),
    ("AGRICULTURE", [
        ("fmp_corn", "Corn front month", "¢/bu"),
        ("fmp_wheat", "Wheat front month", "¢/bu"),
        ("fmp_soybeans", "Soybeans front month", "¢/bu"),
        ("fmp_soybean_oil", "Soybean oil front month", "¢/lb"),
        ("fmp_coffee", "Coffee front month", "¢/lb"),
        ("fmp_sugar", "Sugar front month", "¢/lb"),
        ("fmp_cocoa", "Cocoa front month", "$/ton"),
        ("fmp_live_cattle", "Live cattle front month", "¢/lb"),
    ]),
]


def _row(conn, code: str, label: str, unit: str) -> dict:
    obs = dict(vintage.latest(conn, code))
    if not obs:
        return {"code": code, "label": label, "unit": unit, "value": None,
                "as_of": None, "yoy_pct": None, "chg_30d_pct": None, "spark": []}
    dates = sorted(obs)
    as_of = dates[-1]
    yoy = pct_change_daily(obs, as_of, 365)
    row = {"code": code, "label": label, "unit": unit,
           "value": round(obs[as_of], 4), "as_of": as_of,
           "yoy_pct": yoy,
           "chg_30d_pct": pct_change_daily(obs, as_of, 30),
           "spark": [round(obs[d], 4) for d in dates[-SPARK_OBS:]],
           "spark_span": _span(dates[-SPARK_OBS:][0], as_of)}
    if yoy is None:
        alt = _alt_change(obs, as_of)
        if alt:
            row["chg_alt"] = alt
    return row


def _pjm_capacity_row(markets) -> dict:
    """PJM's Base Residual Auction clearing prices, latest delivery year first;
    the change is auction-to-auction (each clears a different delivery year)."""
    label, unit = "PJM capacity, auction clearing", "$/MW-day"
    pjm = next((m for m in markets if m.get("iso") == "PJM" and m.get("rows")), None)
    if pjm is None:
        return {"code": PJM_CAPACITY, "label": label, "unit": unit, "value": None,
                "as_of": None, "yoy_pct": None, "chg_30d_pct": None, "spark": []}
    rows = pjm["rows"]
    last = rows[-1]
    row = {"code": PJM_CAPACITY, "label": f"{label} ({last['period']})", "unit": unit,
           "value": round(last["price_mw_day"], 2), "as_of": pjm["asof"],
           "yoy_pct": None, "chg_30d_pct": None,
           "spark": [round(r["price_mw_day"], 2) for r in rows],
           "spark_span": f"{rows[0]['period']}–{last['period']} auctions"}
    if len(rows) > 1 and rows[-2]["price_mw_day"]:
        row["chg_alt"] = {"pct": round((last["price_mw_day"] / rows[-2]["price_mw_day"] - 1) * 100, 2),
                          "label": f"vs {rows[-2]['period']} auction"}
    return row


def build(conn, capacity_markets=None) -> dict:
    """capacity_markets: dc_power's curated list; None loads the config (a
    config error degrades the PJM row to null, never the publish)."""
    if capacity_markets is None:
        try:
            capacity_markets = list(dc_power.load().capacity_markets)
        except Exception:
            capacity_markets = []
    return {"groups": [{"group": name,
                        "rows": [_pjm_capacity_row(capacity_markets) if spec[0] == PJM_CAPACITY
                                 else _row(conn, *spec) for spec in rows]}
                       for name, rows in GROUPS]}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "commodities.json")
