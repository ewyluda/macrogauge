"""Writer for compare.json — monthly ours-vs-official YoY + validation stats.

The validation block carries the Phase-1 exit criterion (tracker Pearson corr
vs official >= 0.95 on the 2018-now backfill); 1c's methodology page reads it
from here.
"""
import json
import statistics
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.store import vintage


def _official_yoy(conn, code: str = "CPIAUCNS") -> dict[str, float]:
    series = dict(vintage.latest(conn, code))
    out = {}
    for m, v in series.items():
        base = f"{int(m[:4]) - 1:04d}-{m[5:7]}-01"
        if base in series:
            out[m] = (v / series[base] - 1) * 100
    return out


def _validation(official: list[float], ours: list[float | None]) -> dict:
    pairs = [(o, s) for o, s in zip(official, ours) if s is not None]
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


def build(gauge_result: dict, conn) -> dict:
    off = _official_yoy(conn)
    months = [m for m in sorted(off) if m >= PUBLISH_START]
    official_col = [round(off[m], 2) for m in months]
    payload = {"months": months, "official_yoy_pct": official_col,
               "validation": {}}
    window = f"{months[0][:7]}..{months[-1][:7]}" if months else ""
    for name, v in gauge_result["variants"].items():
        raw = [v["yoy"].get(m) for m in months]
        payload[f"{name}_yoy_pct"] = [None if x is None else round(x, 2)
                                      for x in raw]
        payload["validation"][name] = {
            **_validation([off[m] for m in months], raw), "window": window}
    return payload


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "compare.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
