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

`movers` (2026-10-08) widens the diff past the CPI readings to every page's
lead numbers — compute indexes, each power hub, rates and credit, copper,
the capacity tracker, the long-lead packages, the DC and gauge headlines —
read the same way from the previous and the current artifacts (_readings).
Each carries a STATED notable move (NOTABLE: a design threshold, not a
fitted volatility), and movers rank by |change| / notable, so a 6bp move in
the 10-year and a 4% move at a power hub sort on one scale. A level reads as
a % change, a rate or spread in bp, a YoY in pp. A power hub's average can
sit at or below zero, where a % change runs backwards (−$10 to +$10 reads
−200%), so off a nonpositive previous average it reads as an absolute
$/MWh change against its own stated notable move.
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
    snap = _snapshot(out_dir)
    if snap is not None:
        snap["readings"] = _readings(out_dir)
    return snap


# kind -> (how a change is measured, its unit); NOTABLE: the move that counts
# as notable for one reading of that kind (stated, see module docstring)
KINDS = {"level": "%", "rate": "bp", "yoy": "pp"}
NOTABLE = {"index": 1.0, "hub": 3.0, "hub_abs": 2.0, "copper": 2.0, "ev": 3.0, "mw": 0.5,
           "treasury": 5.0, "credit": 5.0, "hy": 10.0, "sofr": 3.0,
           "pkg_yoy": 0.5, "dc_yoy": 0.1, "gauge_yoy": 0.05}


def _r(label, section, kind, unit, notable, href, value, as_of):
    return {"label": label, "section": section, "kind": kind, "unit": unit,
            "notable": NOTABLE[notable], "href": href, "value": value, "as_of": as_of}


def _readings(out_dir: Path) -> dict:
    """{key: reading} for every page's lead numbers, from the artifacts on
    disk. A missing file or field drops its readings, never the rest."""
    out = {}

    def get(name):
        d = _read(out_dir, name)
        return d if isinstance(d, dict) else {}

    c = get("compute.json")
    for k, label in (("token_index", "Token price index"), ("gpu_index", "GPU-hour index")):
        b = c.get(k) or {}
        if b.get("value") is not None:
            out[f"compute_{k}"] = _r(label, "AI Infra", "level", "index", "index", "/compute", b["value"], b.get("as_of"))
    dc = get("datacenter.json")
    for h in (dc.get("power") or {}).get("hubs") or []:
        if h.get("avg30") is not None:
            out[f"hub_{h['code']}"] = _r(f"{h['label']} 30-day average", "AI Infra", "level", "$/MWh", "hub",
                                         "/power", h["avg30"], h.get("asof"))
    for k, label in DC_LABELS.items():
        b = (dc.get("indexes") or {}).get(k) or {}
        if b.get("headline_yoy_pct") is not None:
            out[f"dc_{k}"] = _r(f"{label} index YoY", "AI Infra", "yoy", "%", "dc_yoy", "/datacenter",
                                b["headline_yoy_pct"], b.get("as_of"))
    r = get("rates.json")
    ten = next((x for x in r.get("curve") or [] if x.get("code") == "DGS10"), None)
    if ten and ten.get("value") is not None:
        out["rates_dgs10"] = _r("10-year Treasury yield", "AI Infra", "rate", "%", "treasury", "/rates",
                                ten["value"], ten.get("as_of"))
    credit = r.get("credit") or {}
    for k, label, n in (("bbb_yield", "BBB corporate bond yield", "credit"),
                        ("hy_oas", "High-yield spread (OAS)", "hy")):
        b = credit.get(k) or {}
        if b.get("value") is not None:
            out[f"rates_{k}"] = _r(label, "AI Infra", "rate", "%", n, "/rates", b["value"], b.get("as_of"))
    sofr = (r.get("funding") or {}).get("sofr_30d") or {}
    if sofr.get("value") is not None:
        out["rates_sofr_30d"] = _r("30-day average SOFR", "AI Infra", "rate", "%", "sofr", "/rates",
                                   sofr["value"], sofr.get("as_of"))
    cm = get("commodities.json")
    for g in cm.get("groups") or []:
        for row in g.get("rows") or []:
            if row.get("code") == "fmp_copper" and row.get("value") is not None:
                out["copper"] = _r("Copper front month", "AI Infra", "level", "$/lb", "copper", "/commodities",
                                   row["value"], row.get("as_of"))
    cap = get("capacity.json")
    op = ((cap.get("cohorts") or {}).get("all") or {}).get("op")
    if op is not None:
        out["capacity_op_mw"] = _r("Tracked operational AI capacity", "AI Infra", "level", "MW", "mw", "/capacity",
                                   op, cap.get("as_of_curated"))
    ev = (cap.get("reference") or {}).get("cohort_ev_b")
    if ev is not None:
        out["capacity_ev"] = _r("Priced neocloud enterprise value", "AI Infra", "level", "$B", "ev", "/capacity",
                                ev, cap.get("priced_date"))
    for p in get("longlead.json").get("packages") or []:
        if p.get("price_yoy_pct") is not None:
            out[f"longlead_{p['code']}"] = _r(f"{p.get('label', p['code'])} price YoY", "AI Infra", "yoy", "%",
                                              "pkg_yoy", "/longlead", p["price_yoy_pct"], p.get("price_last_obs"))
    pulse = get("pulse.json")
    variants = get("gaptable.json").get("variants") or {}
    for key, label in VARIANT_LABELS.items():
        b = pulse.get(key) if key in ("gauge", "tracker") else variants.get(key)
        if b and b.get("yoy_pct") is not None:
            out[f"gauge_{key}"] = _r(f"{label} YoY", "Inflation", "yoy", "%", "gauge_yoy", "/" if key == "gauge" else "/gap",
                                     b["yoy_pct"], b.get("as_of"))
    return out


def _movers(cur: dict, prev: dict | None) -> list[dict]:
    """Every current reading against the previous publish's, ranked by
    |change| / notable; a reading the previous publish lacked has no change."""
    rows = []
    for key, r in cur.items():
        p = (prev or {}).get(key) or {}
        pv, v = p.get("value"), r["value"]
        unit, notable = KINDS[r["kind"]], r["notable"]
        if pv is None or v is None:
            delta = None
        elif r["kind"] == "level" and pv <= 0 and r["unit"] == "$/MWh":
            # a % change off a nonpositive price reverses its sign
            delta, unit, notable = round(v - pv, 2), "$/MWh", NOTABLE["hub_abs"]
        elif r["kind"] == "level":
            delta = None if pv <= 0 else round((v / pv - 1) * 100, 2)
        elif r["kind"] == "rate":
            delta = round((v - pv) * 100, 1)
        else:
            delta = round(v - pv, 2)
        sig = None if delta is None else round(abs(delta) / notable, 2)
        rows.append({"key": key, **r, "notable": notable, "prev_value": pv, "prev_as_of": p.get("as_of"),
                     "delta": delta, "delta_unit": unit, "significance": sig})
    rows.sort(key=lambda x: (-(x["significance"] or 0), x["key"]))
    return rows


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
            "gate_holds": list(gate_flags or []),
            "movers": _movers(_readings(out_dir), (prev or {}).get("readings"))}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "changes.json")
