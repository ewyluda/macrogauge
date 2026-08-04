"""Capacity tracker config — the hand-curated MW layer for /capacity.

MW numbers are curated from filings (no API exists for them); the daily FMP_EQ
batch reprices the valuation side. Spec:
docs/superpowers/specs/2026-07-21-capacity-tracker-design.md."""
import json
import re
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "capacity.json"

ROLES = {"neocloud", "landlord", "operator", "hyperscaler", "exploratory"}
# Cohort split for the page's toggle: everything non-hyperscaler is the
# sellable-MW cohort the original tracker covered.
NEOCLOUD_ROLES = {"neocloud", "landlord", "operator", "exploratory"}
SITE_STATUSES = {"o", "c", "p", "s"}  # operating/construction/planned/secured

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _require_num_or_none(where: str, field: str, v) -> None:
    if v is not None and (not isinstance(v, (int, float)) or isinstance(v, bool)):
        raise ValueError(f"{where}: {field} must be a number or null, got {v!r}")


def cap_series(ticker: str) -> str:
    return f"fmp_cap_{ticker.lower()}"


def px_series(ticker: str) -> str:
    return f"fmp_px_{ticker.lower()}"


def load_capacity(path: Path | None = None,
                  registry_codes: set[str] | None = None,
                  market_keys: set[str] | None = None) -> dict:
    if market_keys is None:
        from pipeline import dc_markets
        market_keys = {m.key for m in dc_markets.load(registry_codes=registry_codes)}
    raw = json.loads((path or DEFAULT_PATH).read_text())
    # Everything below fails LOUDLY at load time, inside the isolated capacity
    # phase. The alternative — leaking a curation typo through to JSON Schema
    # validation as the artifact is written — aborts the entire daily run
    # (run_daily re-raises ValidationError by design), because tenants/geo/
    # geo_unmapped and several company fields pass through build() verbatim
    # into schema-constrained artifact fields. Same principle as
    # dc_longlead.load; tests/test_dc_longlead.py states it verbatim.
    if raw.get("schema_version") != 1:
        raise ValueError("capacity: schema_version must be 1")
    if not isinstance(raw.get("as_of_curated"), str) or \
            not _DATE_RE.match(raw["as_of_curated"]):
        raise ValueError(f"capacity: as_of_curated must be YYYY-MM-DD, "
                         f"got {raw.get('as_of_curated')!r}")
    for field in ("note", "geo_note"):
        if not isinstance(raw.get(field), str) or not raw[field]:
            raise ValueError(f"capacity: {field} must be a non-empty string")
    if not isinstance(raw.get("basis"), dict):
        raise ValueError("capacity: basis must be an object")
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
        if not isinstance(c.get("n"), str) or not c["n"]:
            raise ValueError(f"{c['t']}: n must be a non-empty string")
        if c.get("dupe") is not None and not isinstance(c["dupe"], str):
            raise ValueError(f"{c['t']}: dupe must be a string or null")
        for field in ("nd", "bk", "valuation_b"):
            _require_num_or_none(c["t"], field, c.get(field))
        # sites rows feed publish/capacity._events by positional unpack, and
        # mw/when drive the tl/timeline artifact fields.
        for s in c["sites"]:
            if (not isinstance(s, list) or len(s) != 4
                    or not isinstance(s[0], str)
                    or not isinstance(s[3], str)
                    or s[2] not in SITE_STATUSES):
                raise ValueError(f"{c['t']}: sites rows must be "
                                 f"[name, mw, o|c|p|s, when], got {s!r}")
            _require_num_or_none(c["t"], "sites mw", s[1])
        for s in c["src"]:
            if (not isinstance(s, list) or len(s) != 2
                    or not all(isinstance(x, str) and x for x in s)):
                raise ValueError(f"{c['t']}: src rows must be [label, url], "
                                 f"got {s!r}")
        if not isinstance(c.get("econ"), dict):
            raise ValueError(f"{c['t']}: econ must be an object")
    known = set(tickers)
    for tn in raw["tenants"]:
        # Verbatim artifact passthrough; the schema pins [str, str,
        # number|null, str] at write time.
        if (not isinstance(tn, list) or len(tn) != 4
                or not isinstance(tn[0], str) or not isinstance(tn[3], str)):
            raise ValueError(f"tenants rows must be [tenant, ticker, mw, "
                             f"terms], got {tn!r}")
        _require_num_or_none("tenants", "mw", tn[2])
        if tn[1] not in known:
            raise ValueError(f"tenants references unknown ticker {tn[1]}")
    for g in list(raw["geo"]) + list(raw["geo_unmapped"]):
        if g["t"] not in known:
            raise ValueError(f"geo references unknown ticker {g['t']}")
        if not isinstance(g.get("site"), str) or not g["site"]:
            raise ValueError(f"{g['t']}: geo site must be a non-empty string")
        if g.get("st") not in SITE_STATUSES:
            raise ValueError(f"{g['t']}/{g.get('site')}: geo st must be o|c|p|s")
        _require_num_or_none(f"{g['t']}/{g['site']}", "geo mw", g.get("mw"))
        m = g.get("market")
        if m is not None and m not in market_keys:
            raise ValueError(f"geo references unknown market {m}")
    for g in raw["geo"]:
        for field, lo, hi in (("lat", -90, 90), ("lng", -180, 180)):
            v = g.get(field)
            if (not isinstance(v, (int, float)) or isinstance(v, bool)
                    or not lo <= v <= hi):
                raise ValueError(f"{g['t']}/{g['site']}: {field} must be a "
                                 f"number in [{lo}, {hi}], got {v!r}")
        if not isinstance(g.get("approx"), bool):
            raise ValueError(f"{g['t']}/{g['site']}: approx must be a boolean")
        if "when" in g and not isinstance(g["when"], str):
            raise ValueError(f"{g['t']}/{g['site']}: when must be a string")
    for g in raw["geo_unmapped"]:
        if not isinstance(g.get("why"), str) or not g["why"]:
            raise ValueError(f"{g['t']}/{g['site']}: geo_unmapped why must be "
                             f"a non-empty string")
    if registry_codes is not None:
        missing = [c["t"] for c in comps if not c["private"]
                   and cap_series(c["t"]) not in registry_codes]
        if missing:
            raise ValueError(f"no fmp_cap_* series registered for: {missing}")
    return raw
