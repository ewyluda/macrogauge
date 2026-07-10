"""Basket config — the 14 CPI components: weights, official series, live specs."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "basket.json"


@dataclass(frozen=True)
class Component:
    code: str                            # internal component id, e.g. "shelter_owned"
    label: str                           # display label (gaptable rows)
    weight: float                        # BLS relative-importance seed weight
    official_series: str                 # store series code of the official BLS index
    live_blend: dict[str, float] | None  # store series code -> design blend weight
    live_variants: tuple[str, ...]       # variants whose live blend drives this component
    lead_days: dict[str, int] | None = None  # store series code -> +days shift (wholesale leads retail)
    pce_weight: float = 0.0              # hand-seeded BEA-share weight, used by the "pce" variant


def load_basket(path: Path | None = None) -> tuple[str, list[Component]]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    comps = [Component(code=c["code"], label=c["label"], weight=c["weight"],
                       official_series=c["official_series"],
                       live_blend=c.get("live_blend"),
                       live_variants=tuple(c.get("live_variants", [])),
                       lead_days=c.get("lead_days"),
                       pce_weight=c["pce_weight"])
             for c in raw["components"]]
    codes = [c.code for c in comps]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"duplicate component codes: {sorted(dupes)}")
    total = sum(c.weight for c in comps)
    if abs(total - 1.0) > 1e-9:
        raise ValueError(f"basket weights sum to {total}, expected 1.0")
    pce_total = sum(c.pce_weight for c in comps)
    if abs(pce_total - 1.0) > 1e-9:
        raise ValueError(f"basket pce_weights sum to {pce_total}, expected 1.0")
    for c in comps:
        if c.live_variants and not c.live_blend:
            raise ValueError(f"{c.code}: live_variants requires live_blend")
        if c.lead_days:
            unknown = set(c.lead_days) - set(c.live_blend or {})
            if unknown:
                raise ValueError(f"{c.code}: lead_days keys not in live_blend: "
                                 f"{sorted(unknown)}")
    return raw["base_month"], comps


def load_supercore_components(path: Path | None = None) -> tuple[str, ...]:
    """The 'supercore' variant's subset: a services-ex-shelter approximation
    over our 14 coarse components (includes goods subcomponents inside those
    categories — an honest caveat, not a true PCE core-services cut)."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    supercore = tuple(raw["supercore_components"])
    codes = {c["code"] for c in raw["components"]}
    unknown = set(supercore) - codes
    if unknown:
        raise ValueError(f"supercore_components not in basket: {sorted(unknown)}")
    return supercore
