"""DC power panel config — wholesale hub identifiers + hand-seeded PJM
capacity-auction results (spec §5, "The power bill").

Loader precedent: pipeline/dc_basket.py. Hub and Henry Hub codes are
validated against the registry (registry_codes injectable for tests, same
pattern); capacity_auction rows must be non-empty with numeric
price_mw_day — a typo'd or emptied config must fail loudly at load time,
never publish a blank or garbled auction table."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_power.json"


@dataclass(frozen=True)
class HubSpec:
    code: str    # store series code, e.g. "caiso_sp15_da"
    label: str   # display label


@dataclass(frozen=True)
class PowerConfig:
    hubs: tuple[HubSpec, ...]
    henry_hub: HubSpec
    capacity_auction: dict   # {"source": str, "asof": str,
                             #  "rows": [{"delivery_year": str, "price_mw_day": float}, ...]}


def load(path: Path | None = None,
        registry_codes: set[str] | None = None) -> PowerConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}
    hubs = tuple(HubSpec(code=h["code"], label=h["label"]) for h in raw["hubs"])
    henry_hub = HubSpec(code=raw["henry_hub"]["code"], label=raw["henry_hub"]["label"])
    codes = [h.code for h in hubs]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"dc_power: duplicate hub codes {sorted(dupes)}")
    for h in (*hubs, henry_hub):
        if h.code not in registry_codes:
            raise ValueError(f"dc_power: unknown series code {h.code}")
    cap = raw["capacity_auction"]
    rows = cap.get("rows", [])
    if not rows:
        raise ValueError("dc_power: capacity_auction rows must be non-empty")
    for r in rows:
        if not isinstance(r.get("price_mw_day"), (int, float)):
            raise ValueError(
                f"dc_power: capacity_auction row {r.get('delivery_year')} "
                f"price_mw_day must be numeric")
    return PowerConfig(hubs=hubs, henry_hub=henry_hub,
                       capacity_auction={"source": cap["source"], "asof": cap["asof"],
                                          "rows": rows})
