"""Writer for matrix.json — the 'every underlying inflation measure' grouped
table. Display-only; each row's value is the latest store observation verbatim,
except the PIPELINE rows (PPIACO, IREXPETCOM) whose published value is a
computed own-obs like-month YoY off the index level (locked decision 6). Fixed
shape: groups and rows are always present, values null when the store lacks
them — a new writer must never take down the publish block.
"""
import json
from pathlib import Path

from pipeline.dates import months_back
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
    ]),
    ("PIPELINE", [
        ("PPIACO", "PPI all commodities", "% YoY (computed)", "monthly", True),
        ("IREXPETCOM", "Import prices ex-petroleum", "% YoY (computed)", "monthly", True),
    ]),
    ("EXPECTATIONS", [
        ("T5YIE", "5-year breakeven", "%", "daily", False),
        ("T10YIE", "10-year breakeven", "%", "daily", False),
        ("MICH", "UMich 1-year expectation", "%", "monthly", False),
    ]),
]


def _row(conn, code: str, label: str, unit: str, cadence: str,
         computed_yoy: bool) -> dict:
    obs = dict(vintage.latest(conn, code))
    if not obs:
        return {"code": code, "label": label, "value": None,
                "unit": unit, "as_of": None, "cadence": cadence}
    as_of = max(obs)
    if computed_yoy:
        base = obs.get(months_back(as_of, 12))
        value = None if not base else round((obs[as_of] / base - 1) * 100, 2)
    else:
        value = round(obs[as_of], 2)
    return {"code": code, "label": label, "value": value,
            "unit": unit, "as_of": as_of, "cadence": cadence}


def build(conn) -> dict:
    return {"groups": [{"group": name, "rows": [_row(conn, *r) for r in rows]}
                       for name, rows in GROUPS]}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "matrix.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
