"""Engine stage 5: per-variant component construction.

gauge   — the market-rent blend drives BOTH shelter components.
tracker — official shelter dynamics; only fuel/electricity/nat_gas ride live.
Which components ride live data in which variant is config (live_variants in
config/basket.json), not code.
"""
from pipeline import basket
from pipeline.engine import blend as blend_mod
from pipeline.engine import rebase as rebase_mod

VARIANTS = ("gauge", "tracker")


def build_component(comp: basket.Component, variant: str,
                    official_series: dict[str, float],
                    live_sources: dict[str, dict[str, float]],
                    live_blend: dict[str, float] | None = None
                    ) -> tuple[dict[str, float], str, dict[str, float]]:
    """Assemble one component's index for one variant.

    live_blend defaults to the component's configured blend; the CoL variant
    passes an override for shelter_owned (payment index, weight 1.0)."""
    official_idx = rebase_mod.rebase(official_series)
    blend_weights = comp.live_blend if live_blend is None else live_blend
    if variant in comp.live_variants and any(live_sources.values()):
        live = blend_mod.blend(
            {k: rebase_mod.rebase(v) for k, v in live_sources.items() if v},
            blend_weights)
        assembled = blend_mod.splice(official_idx, live)
        return rebase_mod.rebase(assembled), "live", official_idx
    return official_idx, "bls_cf", official_idx
