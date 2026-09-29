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


# Effective tariff rate (backlog #10b): federal customs duties / imports of
# goods, both NIPA quarterly SAAR $bn (a consistent pair — same source table
# family, same seasonal adjustment and annualization, so the SAAR factors
# cancel). Verified live 2026-09-28: 2026Q2 326.3 / 3697.4 = 8.83%;
# 2025Q1 97.0 / 3681.4 = 2.63%. Derived, so its row code names both series.
TARIFF_NUM, TARIFF_DEN = "B235RC1Q027SBEA", "A255RC1Q027SBEA"
TARIFF_CODE = f"{TARIFF_NUM}/{TARIFF_DEN}"
TARIFF_LABEL = "Effective tariff rate (customs duties / goods imports)"
TARIFF_START = "2018-01-01"


def _tariffs(conn) -> dict:
    num = dict(vintage.latest(conn, TARIFF_NUM))
    den = dict(vintage.latest(conn, TARIFF_DEN))
    quarters = sorted(d for d in set(num) & set(den) if d >= TARIFF_START and den[d])
    rate = [round(100 * num[d] / den[d], 3) for d in quarters]
    return {"as_of": quarters[-1] if quarters else None,
            "rate_pct": rate[-1] if rate else None,
            "numerator": TARIFF_NUM, "denominator": TARIFF_DEN,
            "method": "customs duties / imports of goods, both BEA NIPA quarterly "
                      "SAAR $bn; latest quarter both series have printed",
            "history": {"dates": quarters, "rate_pct": rate,
                        "customs_bn": [round(num[d], 3) for d in quarters],
                        "goods_imports_bn": [round(den[d], 3) for d in quarters]}}


def _tariff_row(t: dict) -> dict:
    return {"code": TARIFF_CODE, "label": TARIFF_LABEL,
            "value": None if t["rate_pct"] is None else round(t["rate_pct"], 2),
            "unit": "% of goods imports", "as_of": t["as_of"], "cadence": "quarterly"}


def build(conn) -> dict:
    tariffs = _tariffs(conn)
    groups = []
    for name, rows in GROUPS:
        out = [_row(conn, *r) for r in rows]
        if name == "PIPELINE":
            out.append(_tariff_row(tariffs))
        groups.append({"group": name, "rows": out})
    return {"groups": groups, "tariffs": tariffs}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "matrix.json")
