"""Writer for official.json — the interim dashboard's data (no gauge yet)."""
import json
from pathlib import Path

from pipeline.engine import official as engine

HEADLINE = ("CPIAUCNS", "CPILFENS")

SHORT_LABELS = {
    "CUUR0000SAF11": "Food at home", "CUUR0000SEFV": "Food away from home",
    "CUUR0000SAM": "Medical care", "CUUR0000SAA": "Apparel",
    "CUUR0000SAR": "Recreation", "CUUR0000SAE": "Education & comm",
    "CUUR0000SAG": "Other goods & services", "CUUR0000SETA01": "New vehicles",
    "CUUR0000SETA02": "Used cars & trucks", "CUUR0000SEHA": "Rent",
    "CUUR0000SEHC": "Owners' equiv. rent", "CUUR0000SEHF01": "Electricity (CPI)",
    "CUUR0000SEHF02": "Piped gas (CPI)", "CUUR0000SETB01": "Gasoline (CPI)",
}

QUOTES = {  # code -> (label, group, unit)
    "APU0000708111": ("Eggs, dozen", "grocery", "$"),
    "APU0000709112": ("Milk, gallon", "grocery", "$"),
    "APU0000702111": ("Bread, lb", "grocery", "$"),
    "APU0000703112": ("Ground beef (100%), lb", "grocery", "$"),
    "APU0000706111": ("Chicken, lb", "grocery", "$"),
    "APU0000711211": ("Bananas, lb", "grocery", "$"),
    "eia_gasreg_w": ("Gas, regular", "energy", "$/gal"),
    "eia_elec_res": ("Electricity", "energy", "¢/kWh"),
    "eia_ng_res": ("Natural gas", "energy", "$/Mcf"),
    "pmms_30yr": ("30yr mortgage", "rates", "%"),
    "fmp_gold": ("Gold", "markets", "$/oz"),
    "fmp_wti": ("WTI crude", "markets", "$/bbl"),
    "fiscal_debt_total": ("Total public debt", "fiscal", "$"),
}


def _round(x, nd=2):
    return None if x is None else round(x, nd)


def build(conn, series) -> dict:
    def headline_row(code):
        r = engine.latest_yoy(conn, code)
        return {"month": r["month"], "yoy_pct": round(r["yoy_pct"], 2),
                "prev_yoy_pct": round(r["prev_yoy_pct"], 2), "as_of": r["as_of"]}

    components = []
    for code, label in SHORT_LABELS.items():
        c = engine.component_summary(conn, code)
        components.append({"code": code, "label": label, "month": c["month"],
                           "yoy_pct": round(c["yoy_pct"], 2),
                           "mom_pct": round(c["mom_pct"], 2)})
    components.sort(key=lambda c: c["yoy_pct"], reverse=True)

    quotes = []
    for code, (label, group, unit) in QUOTES.items():
        try:
            q = engine.latest_quote(conn, code)
        except ValueError:
            continue  # series never collected — publish without it
        row = {"code": code, "label": label, "group": group, "unit": unit,
               "latest": round(q["latest"], 2), "obs_date": q["obs_date"],
               "yoy_pct": _round(q["yoy_pct"])}
        if unit == "%":
            # a rate's relative %-change reads as a pp move next to the
            # level — publish the pp delta so the site can say "−0.25pp"
            row["yoy_pp"] = _round(q["yoy_delta"])
        quotes.append(row)

    cpi_code, core_code = HEADLINE
    return {"headline": {"cpi": headline_row(cpi_code),
                         "core": headline_row(core_code)},
            "components": components, "quotes": quotes}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "official.json"
    path.write_text(json.dumps({"published_at": published_at, **payload}, indent=2) + "\n")
    return path
