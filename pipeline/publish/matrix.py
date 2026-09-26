"""Writer for matrix.json — the 'every underlying inflation measure' grouped
table. Display-only; each row's value is the latest store observation verbatim,
except the PIPELINE rows (PPIACO, IREXPETCOM) whose published value is a
computed own-obs like-month YoY off the index level (locked decision 6). Fixed
shape: groups and rows are always present, values null when the store lacks
them — a new writer must never take down the publish block.
"""
from pathlib import Path

from pipeline.publish.util import write_json, yoy_pct
from pipeline.store import vintage

# (code, label, unit, cadence, computed_yoy). computed_yoy rows publish the
# like-month YoY of a raw index level; the rest publish the latest obs verbatim
# (they are already rates/percentages at the source). Pinned by test_matrix_writer.
GROUPS = [
    ("UNDERLYING", [
        ("MEDCPIM158SFRBCLE", "Median CPI", "% ann. rate (MoM)", "monthly", False),
        ("TRMMEANCPIM158SFRBCLE", "16% trimmed-mean CPI", "% ann. rate (MoM)", "monthly", False),
        ("CORESTICKM159SFRBATL", "Sticky-price core CPI", "% YoY", "monthly", False),
        ("PCETRIM12M159SFRBDAL", "Dallas Fed trimmed-mean PCE", "% YoY", "monthly", False),
        ("COREFLEXCPIM159SFRBATL", "Flexible-price core CPI", "% YoY", "monthly", False),
        ("PCEPILFE", "Core PCE (the Fed's target)", "% YoY (computed)", "monthly", True),
    ]),
    ("PIPELINE", [
        ("PPIACO", "PPI all commodities", "% YoY (computed)", "monthly", True),
        ("IREXPETCOM", "Import prices ex-petroleum", "% YoY (computed)", "monthly", True),
        ("CHNTOT", "Import prices, goods from China", "% YoY (computed)", "monthly", True),
        ("CUSR0000SACL1E", "Core goods CPI (tariff pass-through)", "% YoY (computed)", "monthly", True),
    ]),
    ("EXPECTATIONS", [
        ("T5YIE", "5-year breakeven", "%", "daily", False),
        ("T10YIE", "10-year breakeven", "%", "daily", False),
        ("MICH", "UMich 1-year expectation", "%", "monthly", False),
        ("T5YIFR", "5y5y forward breakeven", "%", "daily", False),
        ("EXPINF1YR", "Cleveland Fed 1-year expected inflation", "%", "monthly", False),
        ("EXPINF10YR", "Cleveland Fed 10-year expected inflation", "%", "monthly", False),
    ]),
    ("LABOR COSTS", [
        ("ECIALLCIV", "Employment Cost Index, total comp", "% YoY (computed)", "quarterly", True),
        ("ULCNFB", "Unit labor costs, nonfarm business", "% YoY (computed)", "quarterly", True),
    ]),
]


def _row(conn, code: str, label: str, unit: str, cadence: str,
         computed_yoy: bool) -> dict:
    obs = dict(vintage.latest(conn, code))
    if not obs:
        return {"code": code, "label": label, "value": None,
                "unit": unit, "as_of": None, "cadence": cadence}
    as_of = max(obs)
    value = yoy_pct(obs, as_of) if computed_yoy else round(obs[as_of], 2)
    return {"code": code, "label": label, "value": value,
            "unit": unit, "as_of": as_of, "cadence": cadence}


def build(conn) -> dict:
    return {"groups": [{"group": name, "rows": [_row(conn, *r) for r in rows]}
                       for name, rows in GROUPS]}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "matrix.json")
