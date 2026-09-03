"""Writer for changes.json — what moved since the previous publish (batch 4e).

Mechanism: the previous publish's artifacts are in the checkout (the daily
run commits site/public/data back), so run_daily snapshots the three small
readings it needs — pulse.json, gaptable.json and datacenter.json's headline
YoYs — BEFORE the engine phase overwrites them (read_previous), and this
writer diffs today's files against that snapshot after every phase has run.
No store change, no new vintage. The first run after deploy (no prior
pulse.json) publishes prev=null and the site says "first reading".

Isolated like every phase: it reads the CURRENT artifacts back from disk
rather than sharing another phase's local result, so a failed engine phase
degrades the headline block to null instead of taking this writer down.
"""
import json
from pathlib import Path

from pipeline.publish.util import write_json

VARIANT_LABELS = {"gauge": "Macrogauge (CPI-comparable)", "tracker": "CPI-Tracker",
                  "col": "Cost of Living", "supercore": "Supercore", "pce": "PCE-weighted"}
DC_LABELS = {"build": "DC Build", "ops": "DC Ops", "hardware": "DC Hardware"}


def _read(out_dir: Path, name: str) -> dict | None:
    p = out_dir / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _snapshot(out_dir: Path) -> dict | None:
    pulse = _read(out_dir, "pulse.json")
    if pulse is None:
        return None
    gt = _read(out_dir, "gaptable.json") or {}
    dc = _read(out_dir, "datacenter.json") or {}
    idx = dc.get("indexes", {}) if isinstance(dc, dict) else {}
    return {"published_at": pulse.get("published_at"),
            "pulse": pulse,
            "variants": gt.get("variants", {}),
            "rows": {r["component"]: r for r in gt.get("rows", [])},
            "dc": {k: {"yoy_pct": idx.get(k, {}).get("headline_yoy_pct"),
                       "as_of": idx.get(k, {}).get("as_of")} for k in DC_LABELS}}


def read_previous(out_dir: Path) -> dict | None:
    """Snapshot of the previous publish; call BEFORE any writer runs."""
    return _snapshot(out_dir)


def _delta(cur, prev):
    return None if cur is None or prev is None else round(cur - prev, 2)


def _headline(cur: dict | None, prev: dict | None) -> list[dict]:
    rows = []
    if cur is None:
        return rows
    pulse, variants, dc = cur["pulse"], cur["variants"], cur["dc"]
    for key, label in VARIANT_LABELS.items():
        block = pulse.get(key) if key in ("gauge", "tracker") else variants.get(key)
        if not block:
            continue
        pblock = None
        if prev:
            pblock = prev["pulse"].get(key) if key in ("gauge", "tracker") else prev["variants"].get(key)
        rows.append({"key": key, "label": label, "kind": "gauge",
                     "value": block.get("yoy_pct"), "as_of": block.get("as_of"),
                     "prev_value": pblock.get("yoy_pct") if pblock else None,
                     "prev_as_of": pblock.get("as_of") if pblock else None,
                     "delta_pp": _delta(block.get("yoy_pct"), pblock.get("yoy_pct") if pblock else None)})
    for key, label in DC_LABELS.items():
        block = dc.get(key) or {}
        pblock = (prev or {}).get("dc", {}).get(key) or {}
        if block.get("yoy_pct") is None:
            continue
        rows.append({"key": f"dc_{key}", "label": label, "kind": "datacenter",
                     "value": block["yoy_pct"], "as_of": block.get("as_of"),
                     "prev_value": pblock.get("yoy_pct"), "prev_as_of": pblock.get("as_of"),
                     "delta_pp": _delta(block["yoy_pct"], pblock.get("yoy_pct"))})
    return rows


def _components(cur: dict | None, prev: dict | None) -> list[dict]:
    if cur is None:
        return []
    out = []
    for code, r in cur["rows"].items():
        p = (prev or {}).get("rows", {}).get(code) or {}
        out.append({"component": code, "label": r.get("label", code), "mode": r.get("mode"),
                    "yoy_pct": r.get("ours_yoy_pct"), "prev_yoy_pct": p.get("ours_yoy_pct"),
                    "delta_pp": _delta(r.get("ours_yoy_pct"), p.get("ours_yoy_pct")),
                    "bls_yoy_pct": r.get("bls_yoy_pct")})
    out.sort(key=lambda x: -abs(x["delta_pp"] or 0))
    return out


def _official(cur: dict | None, prev: dict | None) -> dict | None:
    if cur is None:
        return None
    o = cur["pulse"].get("official") or {}
    po = (prev or {}).get("pulse", {}).get("official") or {}
    return {"month": o.get("month"), "yoy_pct": o.get("yoy_pct"),
            "prev_month": po.get("month"),
            "new_print": bool(po.get("month")) and o.get("month") != po.get("month")}


def build(prev: dict | None, out_dir: Path, source_results, gate_flags=None) -> dict:
    cur = _snapshot(out_dir)
    landed = sorted(({"source": r.source, "new_rows": r.new_rows}
                     for r in (source_results or []) if r.ok and r.new_rows > 0),
                    key=lambda x: (-x["new_rows"], x["source"]))
    failed = sorted(r.source for r in (source_results or []) if not r.ok)
    return {"prev_published_at": prev.get("published_at") if prev else None,
            "headline": _headline(cur, prev),
            "components": _components(cur, prev),
            "official": _official(cur, prev),
            "sources_landed": landed,
            "sources_failed": failed,
            "gate_holds": list(gate_flags or [])}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "changes.json")
