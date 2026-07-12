"""Writer for quilt_months_{24,48,all}.json — month x component YoY heat grid.

Ours = each component's own-observation YoY (like-month honest, Task 1's
series) sampled at month end; official = the component's BLS YoY sampled the
same way. Three window files share one schema; the 2b QuiltHeatmap renders
them directly."""
import json
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.publish import validate

SCHEMAS = Path(__file__).parent.parent.parent / "schemas"

WINDOWS = {"quilt_months_24.json": 24, "quilt_months_48.json": 48,
           "quilt_months_all.json": None}


def _month_ends(dates: list[str]) -> list[tuple[str, str]]:
    """(month, last grid date in month) pairs, ascending."""
    out: list[tuple[str, str]] = []
    for d in dates:
        m = d[:7]
        if out and out[-1][0] == m:
            out[-1] = (m, d)
        else:
            out.append((m, d))
    return out


def _sample(series: dict, ends: list[tuple[str, str]]) -> list:
    return [None if series.get(d) is None else round(series[d], 2)
            for _, d in ends]


def build(gauge_result: dict, comps) -> dict:
    g = gauge_result["variants"]["gauge"]
    dates = [d for d in sorted(g["index"]) if d >= PUBLISH_START]
    ends = _month_ends(dates)
    components = []
    for comp in comps:
        e = g["components"][comp.code]
        components.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "ours_yoy_pct": _sample(e["own_yoy_daily"], ends),
            "official_yoy_pct": _sample(e["official_own_yoy_daily"], ends)})
    return {"rebase": f"{gauge_result['base_month']}=100",
            "months": [m for m, _ in ends], "components": components}


def write(payload: dict, out_dir: Path, published_at: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, window in WINDOWS.items():
        n = len(payload["months"]) if window is None else min(window,
                                                              len(payload["months"]))
        sliced = {"published_at": published_at, "window_months": window,
                  "rebase": payload["rebase"],
                  "months": payload["months"][-n:],
                  "components": [{**c,
                                  "ours_yoy_pct": c["ours_yoy_pct"][-n:],
                                  "official_yoy_pct": c["official_yoy_pct"][-n:]}
                                 for c in payload["components"]]}
        path = out_dir / name
        path.write_text(json.dumps(sliced, separators=(",", ":")) + "\n")
        # Validate immediately, one window at a time — a mid-loop failure must
        # never leave a later window written-but-unvalidated on disk.
        validate.validate_file(path, SCHEMAS / "quilt.schema.json")
        paths.append(path)
    return paths
