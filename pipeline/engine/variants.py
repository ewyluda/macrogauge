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
                    live_sources: dict[str, dict[str, float]]
                    ) -> tuple[dict[str, float], str, dict[str, float]]:
    """Assemble one component's index for one variant.

    Inputs are raw store series ({obs_date: value}); output is re-anchored to
    the base month so every component shares the Laspeyres base point.
    """
    official_idx = rebase_mod.rebase(official_series)
    if variant in comp.live_variants and any(live_sources.values()):
        live = blend_mod.blend(
            {k: rebase_mod.rebase(v) for k, v in live_sources.items() if v},
            comp.live_blend)
        assembled = blend_mod.splice(official_idx, live)
        return rebase_mod.rebase(assembled), "live", official_idx
    return official_idx, "bls_cf", official_idx
