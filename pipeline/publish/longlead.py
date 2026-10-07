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


def _aged(asof: str, cadence: str, today: str) -> bool:
    age = (date.fromisoformat(today) - date.fromisoformat(asof)).days
    return age > ALLOWANCE_DAYS[cadence]


def _stale(vendor, today: str) -> bool:
    if not vendor.figures:
        return False  # a null_note has nothing to age
    newest = max(f.asof for f in vendor.figures)
    return _aged(newest, vendor.cadence, today)


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
            "null_note": vendor.null_note,
            "disclosure_note": vendor.disclosure_note}


def _lead_dict(lt, today: str) -> dict:
    """Stated-only passthrough, like a figure. Lead-time surveys and outlooks
    publish about yearly, so a reading ages on the annual allowance."""
    return {"item": lt.item, "weeks": lt.weeks, "through": lt.through,
            "basis": lt.basis, "period": lt.period, "asof": lt.asof,
            "stale": _aged(lt.asof, "annual", today), "quote": lt.quote,
            "src": {"label": lt.src_label, "url": lt.src_url}}


# Census M3 months of backlog = unfilled orders ÷ monthly shipments, both
# seasonally adjusted (one basis; seasonality is most of the month-to-month
# noise, and a trailing average would add ~6 weeks of lag to a series that is
# already a month behind). Package -> M3 industry group, owner-decided
# 2026-10-01: turbines -> generators; electrical equipment -> switchgear and
# transformers. hvac_equip has no M3 counterpart here.
BACKLOG_GROUPS = {
    "electrical": {"label": "Electrical equipment (NAICS 335)",
                   "unfilled": "fred_uo_electrical_sa", "shipments": "fred_ship_electrical_sa"},
    "turbines": {"label": "Turbines, generators & power transmission (NAICS 333611)",
                 "unfilled": "fred_uo_turbines_sa", "shipments": "fred_ship_turbines_sa"},
}
PACKAGE_BACKLOG = {"switchgear": "electrical", "transformers": "electrical",
                   "generators": "turbines"}
BACKLOG_START = "2015-01-01"


def backlog_months(conn) -> dict:
    """{group: {label, months, ratio, latest, latest_month, change_1y}} from
    the vintage store; a group with no overlapping data is omitted."""
    from pipeline.store import vintage
    out = {}
    for key, g in BACKLOG_GROUPS.items():
        uo = dict(vintage.latest(conn, g["unfilled"]))
        sh = dict(vintage.latest(conn, g["shipments"]))
        months = sorted(m for m in uo if m in sh and sh[m] and m >= BACKLOG_START)
        if not months:
            continue
        ratio = [round(uo[m] / sh[m], 2) for m in months]
        last = months[-1]
        y, mo = int(last[:4]), int(last[5:7])
        year_ago = f"{y - 1:04d}-{mo:02d}-01"
        prev = (round(uo[year_ago] / sh[year_ago], 2)
                if year_ago in uo and sh.get(year_ago) else None)
        # the two legs of the ratio's move: a falling ratio with flat unfilled
        # orders is faster shipping, not cooling demand
        legs = {} if prev is None else {
            "unfilled_yoy_pct": round((uo[last] / uo[year_ago] - 1) * 100, 1),
            "shipments_yoy_pct": round((sh[last] / sh[year_ago] - 1) * 100, 1)}
        out[key] = {"label": g["label"], "months": [m[:7] for m in months], "ratio": ratio,
                    "latest": ratio[-1], "latest_month": last[:7],
                    "change_1y": None if prev is None else round(ratio[-1] - prev, 2),
                    **legs}
    return out


def build(cfg, build_components, dc_result: dict | None, today: str,
          backlog: dict | None = None) -> dict:
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
            # rounded to 2dp to match publish/datacenter.py's yoy_pct field
            # exactly, so the two artifacts can't disagree on the same series
            "price_yoy_pct": None if yoy is None else round(yoy, 2),
            "price_last_obs": None if e is None else e["last_obs"],
            # same rule as publish/datacenter.py's contribution_pp: weight x
            # the UNROUNDED engine yoy (never the rounded price_yoy_pct above)
            "contribution_pp": None if yoy is None else round(comp.weight * yoy, 2),
            "null_note": p.null_note,
            "backlog_group": PACKAGE_BACKLOG.get(p.code) if backlog and PACKAGE_BACKLOG.get(p.code) in backlog else None,
            "lead_times": [_lead_dict(lt, today) for lt in p.lead_times],
            "vendors": [_vendor_dict(k, cfg.vendors[k], today)
                        for k in p.vendor_keys]})
    teaser = []
    for vkey, kind in cfg.teaser:
        vendor = cfg.vendors[vkey]
        fig = next(f for f in vendor.figures if f.kind == kind)  # loader-validated (unique)
        # The teaser ages on ITS OWN figure's asof, not the vendor max: a
        # refreshed sibling figure must not keep a discontinued teaser pick
        # looking fresh on the /datacenter strip — the bare-number surface
        # the stale flag exists for.
        teaser.append({"vendor": vkey, "name": vendor.name,
                       "stale": _aged(fig.asof, vendor.cadence, today),
                       "figure": _figure_dict(fig)})
    return {"as_of_curated": cfg.as_of_curated,
            "build_weight_covered": round(
                sum(by_code[p.code].weight for p in cfg.packages), 4),
            "teaser": teaser,
            "packages": packages,
            "lead_time_benchmark": None if cfg.lead_time_benchmark is None
            else _lead_dict(cfg.lead_time_benchmark, today),
            "backlog_months": backlog or {}}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "longlead.json")
