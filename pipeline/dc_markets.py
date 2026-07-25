"""DC market roster config — tight core counties per real data-center market.

Loader precedent: pipeline/dc_power.py. County FIPS are validated against the
registry (registry_codes injectable for tests, same pattern). A market is
either in an organized market (iso) or it is not (grid names the region);
setting both or neither is a curation error, because the PJM capacity ladder
renders off `iso`.

Markets are TIGHT — the counties where data centers actually are, not the
MSA. Metro definitions dilute the signal: Northern Virginia reads +9.9% wage
YoY tight vs +7.7% across the 11-county metro."""
import json
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_markets.json"

ISOS = frozenset({"PJM", "ERCOT", "MISO", "CAISO", "SPP", "ISONE", "NYISO"})
_FIPS = re.compile(r"^\d{5}$")


@dataclass(frozen=True)
class MarketSpec:
    key: str
    name: str
    counties: tuple[str, ...]
    state: str
    iso: str | None
    grid: str | None
    utility: str
    note: str


def load(path: Path | None = None,
         registry_codes: set[str] | None = None) -> tuple[MarketSpec, ...]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}

    markets = []
    seen: set[str] = set()
    for m in raw["markets"]:
        key = m["key"]
        if key in seen:
            raise ValueError(f"dc_markets: duplicate market key {key}")
        seen.add(key)
        counties = tuple(m["counties"])
        if not counties:
            raise ValueError(f"dc_markets: {key} must have non-empty counties")
        for f in counties:
            if not _FIPS.match(f):
                raise ValueError(
                    f"dc_markets: {key} county {f!r} is not a 5-digit county FIPS")
            for code in (f"qcew_wage23_c{f}", f"qcew_emp23_c{f}"):
                if code not in registry_codes:
                    raise ValueError(f"dc_markets: unknown series code {code}")
        iso, grid = m["iso"], m["grid"]
        if bool(iso) == bool(grid):
            raise ValueError(
                f"dc_markets: {key} must set exactly one of iso/grid")
        if iso and iso not in ISOS:
            raise ValueError(f"dc_markets: {key} unknown iso {iso!r}")
        if len(m["state"]) != 2 or not m["state"].isalpha():
            raise ValueError(f"dc_markets: {key} state must be 2 letters")
        markets.append(MarketSpec(
            key=key, name=m["name"], counties=counties, state=m["state"],
            iso=iso, grid=grid, utility=m["utility"], note=m.get("note", "")))
    return tuple(markets)


def meta(path: Path | None = None) -> dict:
    """The curated-layer metadata the writer republishes verbatim."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    return {"as_of_curated": raw["as_of_curated"], "note": raw["note"]}
