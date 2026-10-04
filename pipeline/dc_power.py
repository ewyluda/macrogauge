"""DC power panel config — wholesale hub identifiers + hand-seeded PJM
capacity-auction results (spec §5, "The power bill").

Loader precedent: pipeline/dc_basket.py. Hub and Henry Hub codes are
validated against the registry (registry_codes injectable for tests, same
pattern); capacity_auction rows must be non-empty with numeric
price_mw_day — a typo'd or emptied config must fail loudly at load time,
never publish a blank or garbled auction table."""
import json
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_power.json"


@dataclass(frozen=True)
class HubSpec:
    code: str          # store series code, e.g. "caiso_sp15_da"
    label: str         # display label
    grid: str = ""     # grid operator / market, e.g. "CAISO"
    region: str = ""   # where the hub prices power, e.g. "Southern California"
    product: str = ""  # what the number is, e.g. "Day-ahead, all-hours average"


@dataclass(frozen=True)
class PowerConfig:
    hubs: tuple[HubSpec, ...]
    henry_hub: HubSpec
    capacity_auction: dict   # {"source": str, "asof": str,
                             #  "rows": [{"delivery_year": str, "price_mw_day": float}, ...]}
    capacity_markets: tuple = ()   # per-ISO capacity prices (hand-curated, cited)
    tariffs: tuple = ()            # utility large-load tariffs (hand-curated, cited)


_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MARKET_STR = ("iso", "name", "product", "note", "source", "source_url", "asof")
_TARIFF_STR = ("utility", "state", "grid", "tariff", "status", "min_take", "term",
               "threshold", "pipeline", "source", "source_url", "asof")


def _check_markets(markets: list) -> tuple:
    """Hand-curated per-ISO capacity prices. Fails loudly: these rows pass
    straight into the published artifact, so a typo must stop the load, not
    publish a garbled chart. An auction ISO needs ascending, numeric rows;
    a no-auction ISO (ERCOT/SPP/CAISO) must carry none."""
    isos = [m.get("iso") for m in markets]
    if len(set(isos)) != len(isos):
        raise ValueError(f"dc_power: duplicate capacity_markets iso in {isos}")
    for m in markets:
        for f in _MARKET_STR:
            if not isinstance(m.get(f), str):
                raise ValueError(f"dc_power: capacity_markets {m.get('iso')} {f} must be a string")
        if not m["source_url"].startswith("https://") or not _DATE.match(m["asof"]):
            raise ValueError(f"dc_power: capacity_markets {m['iso']} needs an https source_url and YYYY-MM-DD asof")
        rows = m.get("rows")
        if m.get("status") == "none":
            if rows:
                raise ValueError(f"dc_power: {m['iso']} has no capacity auction but lists rows")
        elif m.get("status") == "auction":
            periods = [r.get("period") for r in rows or []]
            if not periods or periods != sorted(periods) or len(set(periods)) != len(periods):
                raise ValueError(f"dc_power: {m['iso']} rows must be non-empty and strictly ascending, got {periods}")
            for r in rows:
                if not isinstance(r.get("price_mw_day"), (int, float)) or isinstance(r["price_mw_day"], bool):
                    raise ValueError(f"dc_power: {m['iso']} {r.get('period')} price_mw_day must be numeric")
        else:
            raise ValueError(f"dc_power: {m['iso']} status must be auction|none")
    return tuple(markets)


def _check_tariffs(tariffs: list) -> tuple:
    for t in tariffs:
        for f in _TARIFF_STR:
            if not isinstance(t.get(f), str) or not t[f]:
                raise ValueError(f"dc_power: tariff {t.get('utility')} {f} must be a non-empty string")
        if t.get("confidence") not in ("filed", "press"):
            raise ValueError(f"dc_power: tariff {t['utility']} confidence must be filed|press")
        if not t["source_url"].startswith("https://") or not _DATE.match(t["asof"]):
            raise ValueError(f"dc_power: tariff {t['utility']} needs an https source_url and YYYY-MM-DD asof")
    return tuple(tariffs)


def load(path: Path | None = None,
        registry_codes: set[str] | None = None) -> PowerConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}
    hubs = tuple(HubSpec(code=h["code"], label=h["label"], grid=h.get("grid", ""),
                         region=h.get("region", ""), product=h.get("product", ""))
                 for h in raw["hubs"])
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
    # dcindex.power_block reads rows[0]/rows[-1] for the headline "×" multiple
    # and years_span — a hand-added BRA row inserted out of order would publish
    # a schema-valid nonsense multiple, so ordering is a load-time invariant.
    # Lexicographic order matches chronology for the "2024/25" year format.
    dys = [r.get("delivery_year") for r in rows]
    if not all(isinstance(d, str) and d for d in dys):
        raise ValueError("dc_power: capacity_auction delivery_year must be a "
                         "non-empty string")
    if dys != sorted(dys) or len(set(dys)) != len(dys):
        raise ValueError("dc_power: capacity_auction rows must be strictly "
                         f"ascending by delivery_year, got {dys}")
    return PowerConfig(hubs=hubs, henry_hub=henry_hub,
                       capacity_auction={"source": cap["source"], "asof": cap["asof"],
                                          "rows": rows},
                       capacity_markets=_check_markets(raw.get("capacity_markets", [])),
                       tariffs=_check_tariffs(raw.get("tariffs", [])))
