"""Writer for methodology.json — generated docs; never hand-written.

Everything derives from config + the store + live validation stats so the
methodology page cannot drift from code (1c spec §8). STAGES prose and
LIMITATIONS are the two hand-authored blocks, kept here so review catches
drift when the engine changes."""
import json
from datetime import date
from pathlib import Path

from pipeline.engine.gauge import ENGINE_VERSION
from pipeline.store import vintage

STAGES = [
    {"n": 1, "name": "Rebase",
     "description": "Every series is indexed so its base-month mean = 100, "
                    "making $/gal, cents/kWh and $ rent unitless and comparable.",
     "formula": "idx_t = 100 * value_t / mean(value | month = base)"},
    {"n": 2, "name": "Blend & splice",
     "description": "Volatile components ride live market data grafted onto "
                    "official BLS history at the splice point; weights "
                    "renormalize as sources phase in.",
     "formula": None},
    {"n": 3, "name": "Quality gate",
     "description": "A live component moving more than 5% in one day is held "
                    "at its prior value for one day; if the move persists it "
                    "passes through. Publication never blocks.",
     "formula": None},
    {"n": 4, "name": "Aggregate",
     "description": "Laspeyres headline over the daily grid; headline YoY is "
                    "the weighted sum of each component's like-month YoY at "
                    "its own last observation, carried forward between prints.",
     "formula": "headline_yoy(d) = sum_i w_i * yoy_i(d)"},
    {"n": 5, "name": "Variants",
     "description": "Each published cut assembles the same components with a "
                    "different live/official mix; which component rides live "
                    "data is config, not code.",
     "formula": None},
]

LIMITATIONS = [
    "Components without a live source carry the latest official BLS print "
    "forward between releases (labeled BLS-CF); their between-print YoY is "
    "the last print's, not a nowcast.",
    "Live coverage is a minority of basket weight today; the coverage "
    "percentage is published on every card rather than hidden.",
    "Fuel diverges from BLS by construction: pump-price YoY vs the CPI "
    "gasoline index methodology.",
    "Component YoY is computed at each component's own last observation "
    "(like month vs like month), so lagging series compare honestly at the "
    "cost of timeliness.",
]

VARIANTS = {
    "gauge": "CPI-comparable: the market-rent blend drives both shelter "
             "components; fuel, electricity and piped gas ride live EIA data.",
    "tracker": "Official shelter dynamics; only fuel, electricity and piped "
               "gas ride live — built to re-track the print.",
}


def build(gauge_result: dict, conn, sources: dict, series: list, comps,
          validation: dict, gaptable_payload: dict, cpi: dict,
          today: str) -> dict:
    g = gauge_result["variants"]["gauge"]
    obs_count = conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
    inventory, fresh_count = [], 0
    for s in series:
        latest = vintage.max_obs_date(conn, s.code)
        fresh = (latest is not None
                 and (date.fromisoformat(today)
                      - date.fromisoformat(latest)).days <= s.max_staleness_days)
        fresh_count += fresh
        inventory.append({"code": s.code, "name": s.name, "source": s.source,
                          "route": sources[s.source].route,
                          "cadence": sources[s.source].cadence,
                          "latest_obs": latest, "fresh": fresh})
    basket_rows = []
    for comp in comps:
        e = g["components"][comp.code]
        basket_rows.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "mode": e["mode"],
            "live_sources": sorted(comp.live_blend) if comp.live_blend else [],
            "official_series": comp.official_series,
            "yoy_pct": None if e["yoy_pct"] is None else round(e["yoy_pct"], 2)})
    weighted_bls = sum(r["weight"] * r["bls_yoy_pct"]
                       for r in gaptable_payload["rows"])
    return {
        "stats": {"series_count": len(series), "obs_count": obs_count,
                  "source_count": len(sources),
                  "tracker_corr": validation["tracker"]["corr"],
                  "live_coverage_pct": round(g["coverage_pct"], 2),
                  "engine_version": ENGINE_VERSION,
                  "rebase": f"{gauge_result['base_month']}=100"},
        "stages": STAGES,
        "basket": basket_rows,
        "freshness": {"fresh_count": fresh_count, "total": len(series)},
        "inventory": inventory,
        "validation": {**validation,
                       "bls_reconstruction": {
                           "weighted_bls_yoy_pct": round(weighted_bls, 2),
                           "official_yoy_pct": round(cpi["yoy_pct"], 2)}},
        "variants": VARIANTS,
        "limitations": LIMITATIONS,
    }


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "methodology.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
