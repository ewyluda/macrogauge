"""Capacity tracker config — the hand-curated MW layer for /capacity.

MW numbers are curated from filings (no API exists for them); the daily FMP_EQ
batch reprices the valuation side. Spec:
docs/superpowers/specs/2026-07-21-capacity-tracker-design.md."""
import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "capacity.json"

ROLES = {"neocloud", "landlord", "operator", "hyperscaler", "exploratory"}
# Cohort split for the page's toggle: everything non-hyperscaler is the
# sellable-MW cohort the original tracker covered.
NEOCLOUD_ROLES = {"neocloud", "landlord", "operator", "exploratory"}


def cap_series(ticker: str) -> str:
    return f"fmp_cap_{ticker.lower()}"


def px_series(ticker: str) -> str:
    return f"fmp_px_{ticker.lower()}"


def load_capacity(path: Path | None = None,
                  registry_codes: set[str] | None = None) -> dict:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    comps = raw["companies"]
    tickers = [c["t"] for c in comps]
    dupes = {t for t in tickers if tickers.count(t) > 1}
    if dupes:
        raise ValueError(f"duplicate capacity tickers: {sorted(dupes)}")
    for c in comps:
        if c["role"] not in ROLES:
            raise ValueError(f"{c['t']}: unknown role {c['role']!r}")
        for k in ("op", "con", "plan"):
            v = c[k]
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0:
                raise ValueError(f"{c['t']}: {k} must be a non-negative number, got {v!r}")
        if c["private"] and not c.get("valuation_b"):
            raise ValueError(f"{c['t']}: private row requires valuation_b")
        if c.get("confidence") not in ("filed", "estimate"):
            raise ValueError(f"{c['t']}: confidence must be filed|estimate")
    known = set(tickers)
    for tn in raw["tenants"]:
        if tn[1] not in known:
            raise ValueError(f"tenants references unknown ticker {tn[1]}")
    for g in list(raw["geo"]) + list(raw["geo_unmapped"]):
        if g["t"] not in known:
            raise ValueError(f"geo references unknown ticker {g['t']}")
    if registry_codes is not None:
        missing = [c["t"] for c in comps if not c["private"]
                   and cap_series(c["t"]) not in registry_codes]
        if missing:
            raise ValueError(f"no fmp_cap_* series registered for: {missing}")
    return raw
