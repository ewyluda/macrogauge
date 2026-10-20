"""Fuel-arithmetic constants for /gas (2026-10-19): EIA heat rates by prime
mover and the heat content of delivered gas.

Each heat rate is EIA's average tested heat rate for NATURAL GAS units of one
prime mover (Electric Power Annual Table 8.2). Its `quote` is the year's row,
verbatim from the committed text layer in docs/research/evidence/ (checked in
tests/test_gas.py); the row prints Coal, Petroleum, Natural Gas, Nuclear after
each prime mover (`column_quote`), so the figure must be the THIRD number after
its prime mover's name — a figure lifted from the wrong column fails at load.
The heat content's figure must be the last value on its U.S. row, under the
year it names.

`gas_generation` gives each gas-tagged power deal its gas plant's own stated
MW (PR #134 review): a deal's MW can be contracted load (TeraWulf's 1 GW
against a 760 MW CCGT) or a bundle (Google's 590 MW = 564 MW of gas + 26 MW of
market energy), so burn is computed on the gas nameplate alone. Each figure
must appear in its quote; `null` (with a note) where the source does not split
the gas out, and that deal then has no burn.

A broken config raises at load; the gas phase then publishes without the fuel
arithmetic, never without the prices."""
import json
from dataclasses import dataclass
from pathlib import Path

from pipeline.power_deals import mw_in_quote

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "gas.json"
COLUMNS = ["Coal", "Petroleum", "Natural Gas", "Nuclear"]


@dataclass(frozen=True)
class HeatRate:
    key: str
    label: str
    btu_per_kwh: int
    year: int
    url: str
    evidence: str
    quote: str

    @property
    def mmbtu_per_mwh(self) -> float:
        return self.btu_per_kwh / 1000.0


@dataclass(frozen=True)
class GasGeneration:
    t: str
    facility: str
    gas_mw: int | None
    evidence: str | None
    quote: str | None
    note: str | None


@dataclass(frozen=True)
class GasConfig:
    basis: str
    heat_rates: tuple[HeatRate, ...]
    btu_per_cf: int
    heat_content_year: int
    heat_content_url: str
    heat_content_evidence: str
    heat_content_quote: str
    generation_basis: str
    generation: dict[tuple[str, str], GasGeneration]


def _fmt(n: int) -> str:
    return f"{n:,}"


def _heat_rate(raw: dict) -> HeatRate:
    key, quote, pm = raw["key"], raw["quote"], raw["prime_mover"]
    if not quote.startswith(f"{raw['year']} "):
        raise ValueError(f"gas heat rate {key}: quote is not the {raw['year']} row")
    at = quote.find(f"{pm} ")
    if at < 0:
        raise ValueError(f"gas heat rate {key}: prime mover {pm!r} not in its quote")
    cells = quote[at + len(pm):].split()[:len(COLUMNS)]
    if len(cells) < len(COLUMNS) or cells[COLUMNS.index("Natural Gas")] != _fmt(raw["btu_per_kwh"]):
        raise ValueError(f"gas heat rate {key}: {raw['btu_per_kwh']} is not the Natural Gas "
                         f"column of {pm!r} in its quote")
    return HeatRate(key=key, label=raw["label"], btu_per_kwh=int(raw["btu_per_kwh"]),
                    year=int(raw["year"]), url=raw["url"], evidence=raw["evidence"], quote=quote)


def _generation(raw: dict) -> GasGeneration:
    where = f"gas generation {raw['t']}/{raw['facility']}"
    mw = raw["gas_mw"]
    if mw is None:
        if not raw.get("note"):
            raise ValueError(f"{where}: an unknown gas MW needs a note saying why")
        return GasGeneration(t=raw["t"], facility=raw["facility"], gas_mw=None,
                             evidence=None, quote=None, note=raw["note"])
    if not isinstance(mw, int) or mw <= 0:
        raise ValueError(f"{where}: gas_mw must be a positive integer or null")
    if not raw.get("quote") or not raw.get("evidence") or not mw_in_quote(mw, raw["quote"]):
        raise ValueError(f"{where}: {mw} MW does not appear in its quote")
    return GasGeneration(t=raw["t"], facility=raw["facility"], gas_mw=mw,
                         evidence=raw["evidence"], quote=raw["quote"], note=raw.get("note"))


def load(path: Path | None = None) -> GasConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if raw["column_quote"].split("Prime Mover ")[-1].split() != ["Coal", "Petroleum", "Natural", "Gas", "Nuclear"]:
        raise ValueError("gas config: column_quote no longer names Coal, Petroleum, Natural Gas, Nuclear")
    rates = tuple(_heat_rate(r) for r in raw["heat_rates"])
    if not rates or len({r.key for r in rates}) != len(rates):
        raise ValueError("gas config: heat_rates must be non-empty with unique keys")
    hc = raw["heat_content"]
    head, _, row = hc["quote"].partition(" View History U.S. ")
    years, values = head.split(), row.split()
    if not years or years[-1] != str(hc["year"]) or len(values) != len(years) \
            or values[-1] != _fmt(hc["btu_per_cf"]):
        raise ValueError(f"gas config: heat content {hc['btu_per_cf']} is not the U.S. "
                         f"{hc['year']} value in its quote")
    gens = [_generation(g) for g in raw["gas_generation"]]
    generation = {(g.t, g.facility): g for g in gens}
    if len(generation) != len(gens):
        raise ValueError("gas config: duplicate gas_generation rows")
    return GasConfig(basis=raw["basis"], heat_rates=rates, btu_per_cf=int(hc["btu_per_cf"]),
                     heat_content_year=int(hc["year"]), heat_content_url=hc["url"],
                     heat_content_evidence=hc["evidence"], heat_content_quote=hc["quote"],
                     generation_basis=raw["gas_generation_basis"], generation=generation)
