"""Writers for Phase-4 heat, stress, and recession composites."""
import json
from pathlib import Path

from pipeline.engine import composites
from pipeline.publish import validate
from pipeline.store import vintage

CONFIG = Path(__file__).parent.parent.parent / "config" / "composites.json"
SCHEMAS = Path(__file__).parent.parent.parent / "schemas"


def _write(name: str, payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(json.dumps({"published_at": published_at, **payload}, indent=2) + "\n")
    # Validate immediately, one file at a time — see phase3._write for why.
    validate.validate_file(path, SCHEMAS / f"{path.stem}.schema.json")
    return path


def build_heatcheck(conn, config_path: Path = CONFIG) -> dict:
    cfg = json.loads(config_path.read_text())["heatcheck"]
    indicators = []
    for item in cfg["indicators"]:
        # mode "diff" for rates/spreads (zero-crossing bases break % change);
        # periods scale the ~3-month horizon to the series cadence.
        result = composites.latest_z(vintage.latest(conn, item["code"]),
                                     periods=item.get("periods", 3),
                                     direction=item["direction"],
                                     percent=item.get("mode", "pct") != "diff")
        indicators.append({**item, **(result or {"as_of": None, "momentum": None,
                                                 "z": None})})
    return composites.heat_check(indicators, cfg["group_weights"])


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


def build_stress(conn, config_path: Path = CONFIG) -> dict:
    cfg = json.loads(config_path.read_text())["stress"]
    indicators = []
    for item in cfg:
        series = vintage.latest(conn, item["code"])
        if item.get("transform") == "yoy":
            # transform on the FULL history, then window: the 2019 cut
            # would otherwise eat the first year of computable changes.
            series = _yoy(series)
        rows = [(d, v) for d, v in series if d >= "2019-01-01"]
        if rows:
            indicators.append({**item, "value": rows[-1][1], "as_of": rows[-1][0],
                               "history": [v for _, v in rows]})
    return composites.stress_index(indicators)


def _last(conn, code):
    rows = vintage.latest(conn, code)
    return None if not rows else rows[-1][1]


def build_recession(conn) -> dict:
    claims = [v for _, v in vintage.latest(conn, "ICSA")]
    claims_trigger = None
    if len(claims) >= 52:
        claims_trigger = sum(claims[-13:]) / 13 > 1.10 * (sum(claims[-52:]) / 52)
    definitions = [
        ("Sahm", "SAHMREALTIME", ">= +0.50pp", lambda value: value >= 0.5),
        ("10Y–3M", "T10Y3M", "< 0", lambda value: value < 0),
        ("NFCI", "NFCI", "> 0", lambda value: value > 0),
        ("Claims", "ICSA", "3m avg > 110% of 12m avg", None),
        ("CFNAI", "CFNAIMA3", "< -0.70", lambda value: value < -0.7),
        ("Chauvet-Piger", "RECPROUSM156N", "> 20%", lambda value: value > 20),
    ]
    signals = []
    for name, code, rule, fn in definitions:
        value = _last(conn, code)
        triggered = claims_trigger if code == "ICSA" else (None if value is None else fn(value))
        signals.append({"name": name, "code": code, "rule": rule,
                        "value": value, "triggered": triggered})
    return composites.recession_composite(signals)


def write_all(conn, out_dir: Path, published_at: str) -> list[Path]:
    return [
        _write("heatcheck.json", build_heatcheck(conn), out_dir, published_at),
        _write("stress.json", build_stress(conn), out_dir, published_at),
        _write("recession.json", build_recession(conn), out_dir, published_at),
    ]
