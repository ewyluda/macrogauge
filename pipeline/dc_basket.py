"""DC cost index basket — series-level components, display groups (spec §3).

One component per series: blend()'s renormalize-on-missing semantics is wrong
for distinct goods (a stale steel PPI must carry forward, never hand its
weight to concrete), so weights live at the series level and `group` is a
display rollup only. live_proxy marks a genuine same-concept daily proxy
(futures) grafted via splice_anchored downstream."""
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


def load_baskets(path: Path | None = None,
                 registry_codes: set[str] | None = None
                 ) -> tuple[str, dict[str, list[DCComponent]]]:
    """(base_month, {"build": [...], "ops": [...]}). Validates weight sums,
    duplicate codes, and that every series/live_proxy exists in the registry
    (pass registry_codes explicitly in tests)."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}
    baskets: dict[str, list[DCComponent]] = {}
    for name in ("build", "ops"):
        comps = [DCComponent(code=c["code"], label=c["label"], group=c["group"],
                             series=c["series"], weight=c["weight"],
                             live_proxy=c.get("live_proxy"))
                 for c in raw[name]]
        codes = [c.code for c in comps]
        dupes = {c for c in codes if codes.count(c) > 1}
        if dupes:
            raise ValueError(f"dc_basket {name}: duplicate codes {sorted(dupes)}")
        total = sum(c.weight for c in comps)
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"dc_basket {name}: weights sum to {total}, expected 1.0")
        for c in comps:
            for code in filter(None, (c.series, c.live_proxy)):
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
