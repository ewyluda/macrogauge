"""Long-lead board artifact (P4 spec §6) — /longlead + the /datacenter strip.

Stated-only passthrough: vendor figures publish exactly as curated. The only
arithmetic in this module is the price leg (the same weight x yoy contribution
rule publish/datacenter.py uses) and the staleness age — never on a vendor's
figure values (spec acceptance §10.2)."""
from datetime import date
from pathlib import Path

from pipeline.publish.util import write_json

# a missed earnings season must surface on-page, not silently age (spec §6)
ALLOWANCE_DAYS = {"quarterly": 120, "annual": 430}


def _stale(vendor, today: str) -> bool:
    if not vendor.figures:
        return False  # a null_note has nothing to age
    newest = max(f.asof for f in vendor.figures)
    age = (date.fromisoformat(today) - date.fromisoformat(newest)).days
    return age > ALLOWANCE_DAYS[vendor.cadence]


def _figure_dict(f) -> dict:
    return {"metric": f.metric, "kind": f.kind, "basis": f.basis,
            "scope": f.scope, "value": f.value, "unit": f.unit,
            "period": f.period, "asof": f.asof, "quote": f.quote,
            "src": {"label": f.src_label, "url": f.src_url}}


def _vendor_dict(key: str, vendor, today: str) -> dict:
    return {"key": key, "name": vendor.name, "ticker": vendor.ticker,
            "listed": vendor.listed, "dc_segment": vendor.dc_segment,
            "cadence": vendor.cadence, "stale": _stale(vendor, today),
            "figures": [_figure_dict(f) for f in vendor.figures],
            "null_note": vendor.null_note}


def build(cfg, build_components, dc_result: dict | None, today: str) -> dict:
    by_code = {c.code: c for c in build_components}
    engine = (dc_result or {}).get("indexes", {}).get("build", {}) \
        .get("components", {})
    packages = []
    for p in cfg.packages:
        comp = by_code[p.code]  # loader validated membership against this basket
        e = engine.get(p.code)
        yoy = None if e is None else e["yoy_pct"]
        packages.append({
            "code": p.code, "label": comp.label, "weight": comp.weight,
            "price_yoy_pct": yoy,
            "price_last_obs": None if e is None else e["last_obs"],
            # same rule as publish/datacenter.py: contribution is weight x yoy,
            # unknowable when yoy is
            "contribution_pp": None if yoy is None else round(comp.weight * yoy, 2),
            "null_note": p.null_note,
            "vendors": [_vendor_dict(k, cfg.vendors[k], today)
                        for k in p.vendor_keys]})
    teaser = []
    for vkey, kind in cfg.teaser:
        vendor = cfg.vendors[vkey]
        fig = next(f for f in vendor.figures if f.kind == kind)  # loader-validated
        teaser.append({"vendor": vkey, "name": vendor.name,
                       "figure": _figure_dict(fig)})
    return {"as_of_curated": cfg.as_of_curated,
            "build_weight_covered": round(
                sum(by_code[p.code].weight for p in cfg.packages), 4),
            "teaser": teaser,
            "packages": packages}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "longlead.json")
