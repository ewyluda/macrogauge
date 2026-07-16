"""DC cost index basket — series-level components, display groups (spec §3).

One component per series: blend()'s renormalize-on-missing semantics is wrong
for distinct goods (a stale steel PPI must carry forward, never hand its
weight to concrete), so weights live at the series level and `group` is a
display rollup only. live_proxy marks a genuine same-concept daily proxy
(futures) grafted via splice_anchored downstream. live_proxy_blend is the
multi-source variant (e.g. wholesale power hubs): hub_mean's the sources,
optionally trailing_mean-smooths (live_proxy_smooth_days), then splices the
result the same way — mutually exclusive with live_proxy."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_basket.json"


@dataclass(frozen=True)
class DCComponent:
    code: str                   # internal component id, e.g. "switchgear"
    label: str                  # display label
    group: str                  # display rollup key ("labor", "materials", ...)
    series: str                 # store series code of the monthly backbone
    weight: float               # share of its basket; each basket sums to 1.0
    live_proxy: str | None = None  # store series code of the daily proxy, if any
    live_proxy_blend: tuple[str, ...] | None = None  # multiple same-concept
        # daily proxies (e.g. wholesale power hubs), mutually exclusive with
        # live_proxy — hub_mean'd then trailing-smoothed before splicing
    live_proxy_smooth_days: int | None = None  # trailing_mean window over
        # the blended proxy; only meaningful (and only allowed) with a blend


def load_baskets(path: Path | None = None,
                 registry_codes: set[str] | None = None
                 ) -> tuple[str, dict[str, list[DCComponent]]]:
    """(base_month, {"build": [...], "ops": [...], "hardware": [...]}). Validates weight sums,
    duplicate codes, that every series/live_proxy/live_proxy_blend code exists
    in the registry (pass registry_codes explicitly in tests), that live_proxy
    and live_proxy_blend are mutually exclusive, that live_proxy_smooth_days
    requires a blend, and that a configured blend is non-empty."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}
    baskets: dict[str, list[DCComponent]] = {}
    for name in ("build", "ops", "hardware"):
        comps = []
        for c in raw[name]:
            live_proxy = c.get("live_proxy")
            blend = c.get("live_proxy_blend")
            smooth_days = c.get("live_proxy_smooth_days")
            if live_proxy and blend:
                raise ValueError(
                    f"dc_basket {name}/{c['code']}: live_proxy and "
                    f"live_proxy_blend are mutually exclusive")
            if smooth_days is not None and not blend:
                raise ValueError(
                    f"dc_basket {name}/{c['code']}: live_proxy_smooth_days "
                    f"requires live_proxy_blend")
            if blend is not None and not blend:
                raise ValueError(
                    f"dc_basket {name}/{c['code']}: live_proxy_blend must be "
                    f"non-empty")
            comps.append(DCComponent(
                code=c["code"], label=c["label"], group=c["group"],
                series=c["series"], weight=c["weight"],
                live_proxy=live_proxy,
                live_proxy_blend=tuple(blend) if blend else None,
                live_proxy_smooth_days=smooth_days))
        codes = [c.code for c in comps]
        dupes = {c for c in codes if codes.count(c) > 1}
        if dupes:
            raise ValueError(f"dc_basket {name}: duplicate codes {sorted(dupes)}")
        total = sum(c.weight for c in comps)
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"dc_basket {name}: weights sum to {total}, expected 1.0")
        for c in comps:
            codes_to_check = list(filter(None, (c.series, c.live_proxy))) + list(c.live_proxy_blend or ())
            for code in codes_to_check:
                if code not in registry_codes:
                    raise ValueError(
                        f"dc_basket {name}/{c.code}: unknown series code {code}")
        baskets[name] = comps
    return raw["base_month"], baskets


def load_group_labels(path: Path | None = None) -> dict[str, str]:
    return json.loads((path or DEFAULT_PATH).read_text())["group_labels"]


def parity_shares(baskets: dict[str, list[DCComponent]]) -> tuple[float, float]:
    """(w_labor, w_power) for the pinned parity formula (spec §6): the build
    'labor' group share and the ops 'power' group share."""
    w_labor = sum(c.weight for c in baskets["build"] if c.group == "labor")
    w_power = sum(c.weight for c in baskets["ops"] if c.group == "power")
    if not w_labor or not w_power:
        raise ValueError("parity shares: build needs a 'labor' group, ops a 'power' group")
    return w_labor, w_power


@dataclass(frozen=True)
class GapRow:
    code: str                   # panel row id
    label: str                  # display label
    series: str                 # store series code
    in_basket: bool             # derived: series is a hardware-basket backbone


def load_hardware_gap(path: Path | None = None,
                      registry_codes: set[str] | None = None) -> list[GapRow]:
    """Hedonic-gap panel rows, config order. in_basket is DERIVED from
    hardware-basket series membership — never hand-maintained (spec §2)."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    rows = raw.get("hardware_gap", [])
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}
    hw_series = {c["series"] for c in raw.get("hardware", [])}
    out = [GapRow(code=r["code"], label=r["label"], series=r["series"],
                  in_basket=r["series"] in hw_series) for r in rows]
    codes = [r.code for r in out]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"hardware_gap: duplicate codes {sorted(dupes)}")
    for r in out:
        if r.series not in registry_codes:
            raise ValueError(f"hardware_gap/{r.code}: unknown series code {r.series}")
    return out
