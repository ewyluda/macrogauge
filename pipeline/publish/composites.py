"""Writers for Phase-4 heat, stress, and recession composites.

/macro-cycle (2026-10-08) adds a `history`: the heat and stress scores
recomputed at each of the last HISTORY_MONTHS month-ends from the SAME
latest-vintage series, truncated to that date. It is today's data replayed,
not what the score read at the time (revised series such as payrolls move
under it), and the page says so. Each recession rule also publishes its
numeric `threshold` and comparison `op`, so the page can draw the distance
to a trigger without parsing the rule text."""
import calendar
import json
from bisect import bisect_right
from datetime import date
from pathlib import Path

from pipeline.engine import composites
from pipeline.publish import validate
from pipeline.publish.util import write_json
from pipeline.store import vintage

CONFIG = Path(__file__).parent.parent.parent / "config" / "composites.json"
SCHEMAS = Path(__file__).parent.parent.parent / "schemas"
HISTORY_MONTHS = 60


def _month_ends(last_day: str, n: int) -> list[str]:
    """The n month-end dates ending with last_day's month, oldest first."""
    y, m = int(last_day[:4]), int(last_day[5:7])
    out = []
    for _ in range(n):
        out.append(date(y, m, calendar.monthrange(y, m)[1]).isoformat())
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out[::-1]


def _upto(rows: list[tuple[str, float]], day: str) -> list[tuple[str, float]]:
    """rows (date-sorted) observed on or before day."""
    return rows[:bisect_right([d for d, _ in rows], day)]


def _write(name: str, payload: dict, out_dir: Path, published_at: str) -> Path:
    path = write_json({"published_at": published_at, **payload}, out_dir, name)
    # Validate immediately, one file at a time — see phase3._write for why.
    validate.validate_file(path, SCHEMAS / f"{path.stem}.schema.json")
    return path


def _heat(cfg: dict, series: dict, upto: str | None = None) -> dict:
    indicators = []
    for item in cfg["indicators"]:
        rows = series[item["code"]] if upto is None else _upto(series[item["code"]], upto)
        # mode "diff" for rates/spreads (zero-crossing bases break % change);
        # periods scale the ~3-month horizon to the series cadence.
        result = composites.latest_z(rows, periods=item.get("periods", 3),
                                     direction=item["direction"],
                                     percent=item.get("mode", "pct") != "diff")
        indicators.append({**item, **(result or {"as_of": None, "momentum": None,
                                                 "z": None})})
    return composites.heat_check(indicators, cfg["group_weights"])


def build_heatcheck(conn, config_path: Path = CONFIG, history_months: int = HISTORY_MONTHS) -> dict:
    cfg = json.loads(config_path.read_text())["heatcheck"]
    series = {item["code"]: vintage.latest(conn, item["code"]) for item in cfg["indicators"]}
    out = _heat(cfg, series)
    last = max((r["as_of"] for r in out["indicators"] if r.get("as_of")), default=None)
    if last:
        # month-ends, but the last point is today's reading at its own date
        # (a current-month end would be a date in the future)
        ends = _month_ends(last, history_months)[:-1] + [last]
        out["history"] = {"dates": ends, "score": [_heat(cfg, series, e)["score"] for e in ends]}
    return out


def _yoy(rows: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """12-month % change of a monthly level series. A secularly trending
    nominal aggregate (REVOLSL) percentile-scored as a raw LEVEL sits at
    ~100 forever; the spec's stress signal is its growth rate."""
    by_month = {d[:7]: v for d, v in rows}
    out = []
    for d, v in rows:
        base = by_month.get(f"{int(d[:4]) - 1}{d[4:7]}")
        if base:
            out.append((d, round((v / base - 1) * 100, 2)))
    return out


def _stress(cfg: list, series: dict, upto: str | None = None) -> dict:
    indicators = []
    for item in cfg:
        rows = series[item["code"]] if upto is None else _upto(series[item["code"]], upto)
        if rows:
            indicators.append({**item, "value": rows[-1][1], "as_of": rows[-1][0],
                               "history": [v for _, v in rows]})
    return composites.stress_index(indicators)


def build_stress(conn, config_path: Path = CONFIG, history_months: int = HISTORY_MONTHS) -> dict:
    cfg = json.loads(config_path.read_text())["stress"]
    series = {}
    for item in cfg:
        s = vintage.latest(conn, item["code"])
        if item.get("transform") == "yoy":
            # transform on the FULL history, then window: the 2019 cut
            # would otherwise eat the first year of computable changes.
            s = _yoy(s)
        series[item["code"]] = [(d, v) for d, v in s if d >= "2019-01-01"]
    out = _stress(cfg, series)
    last = max((r["as_of"] for r in out["indicators"] if r.get("as_of")), default=None)
    if last:
        ends = _month_ends(last, history_months)[:-1] + [last]
        out["history"] = {"dates": ends, "score": [_stress(cfg, series, e)["score"] for e in ends]}
    return out


def _last(conn, code):
    rows = vintage.latest(conn, code)
    return None if not rows else rows[-1][1]


def build_recession(conn) -> dict:
    icsa = vintage.latest(conn, "ICSA")
    claims = [v for _, v in icsa]
    claims_ratio = None
    if len(claims) >= 52:
        # Show the quantity the rule tests (13-week avg as % of the 52-week
        # avg), not the latest weekly print — "197000" next to "> 110%" read
        # as nonsense.
        claims_ratio = round(100 * (sum(claims[-13:]) / 13) / (sum(claims[-52:]) / 52), 1)
    # (name, code, rule text, op, threshold): the rule text is the page's
    # label; op/threshold are the same test as data, published beside it
    definitions = [
        ("Sahm", "SAHMREALTIME", ">= +0.50pp", ">=", 0.5),
        ("10Y–3M", "T10Y3M", "< 0", "<", 0.0),
        ("NFCI", "NFCI", "> 0", ">", 0.0),
        ("Claims", "ICSA", "13-week avg > 110% of 52-week avg", ">", 110.0),
        ("CFNAI", "CFNAIMA3", "< -0.70", "<", -0.7),
        ("Chauvet-Piger", "RECPROUSM156N", "> 20%", ">", 20.0),
    ]
    tests = {">=": lambda v, t: v >= t, ">": lambda v, t: v > t, "<": lambda v, t: v < t}
    signals = []
    for name, code, rule, op, threshold in definitions:
        rows = icsa if code == "ICSA" else vintage.latest(conn, code)
        value = claims_ratio if code == "ICSA" else (rows[-1][1] if rows else None)
        signals.append({"name": name, "code": code, "rule": rule, "value": value,
                        "as_of": rows[-1][0] if rows else None,
                        "op": op, "threshold": threshold,
                        "triggered": None if value is None else tests[op](value, threshold)})
    return composites.recession_composite(signals)


def write_all(conn, out_dir: Path, published_at: str) -> list[Path]:
    return [
        _write("heatcheck.json", build_heatcheck(conn), out_dir, published_at),
        _write("stress.json", build_stress(conn), out_dir, published_at),
        _write("recession.json", build_recession(conn), out_dir, published_at),
    ]
