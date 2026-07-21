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
"""
from pathlib import Path

from pipeline.publish.util import pct_change_daily, write_json
from pipeline.store import vintage

SPARK_OBS = 60  # ~3 trading months of daily closes per sparkline

# (code, label, unit) per group; group order is pinned by tests.
GROUPS = [
    ("AI BUILD-OUT", [
        ("fmp_copper", "Copper front month", "$/lb"),
        ("fmp_alum", "Aluminum front month", "$/ton"),
        ("dramex_ddr5_16g", "DDR5 16Gb spot", "$"),
        ("dramex_ddr4_16g", "DDR4 16Gb spot", "$"),
        ("dramex_nand_mlc64", "NAND 64Gb spot", "$"),
        ("vast_h100_sxm", "H100 SXM (vast.ai median)", "$/GPU-hr"),
        ("sfc_h100", "H100 (sfcompute spot)", "$/GPU-hr"),
        ("caiso_sp15_da", "CAISO SP15 day-ahead", "$/MWh"),
        ("ice_pjm_west", "PJM Western Hub", "$/MWh"),
    ]),
    ("ENERGY & POWER", [
        ("fmp_wti", "WTI crude front month", "$/bbl"),
        ("fmp_rbob", "RBOB gasoline front month", "$/gal"),
        ("fmp_natgas", "Nat gas futures front month", "$/MMBtu"),
        ("eia_henry_hub", "Henry Hub spot", "$/MMBtu"),
        ("miso_indiana_da", "MISO Indiana Hub DA", "$/MWh"),
    ]),
    ("METALS", [
        ("fmp_gold", "Gold front month", "$/oz"),
        ("fmp_copper", "Copper front month", "$/lb"),
        ("fmp_alum", "Aluminum front month", "$/ton"),
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
    return {"code": code, "label": label, "unit": unit,
            "value": round(obs[as_of], 4), "as_of": as_of,
            "yoy_pct": pct_change_daily(obs, as_of, 365),
            "chg_30d_pct": pct_change_daily(obs, as_of, 30),
            "spark": [round(obs[d], 4) for d in dates[-SPARK_OBS:]]}


def build(conn) -> dict:
    return {"groups": [{"group": name,
                        "rows": [_row(conn, *spec) for spec in rows]}
                       for name, rows in GROUPS]}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "commodities.json")
