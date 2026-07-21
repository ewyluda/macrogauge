"""Fan-out collection with per-connector failure isolation.

A broken source records an error in its SourceResult (surfaced via
sources_status.json and QA) and lowers freshness — it never blocks the run.
The store's carry-forward semantics make a missed day harmless.
"""
import re
import warnings
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from pipeline.connectors import (aaa, aptlist, bls, caiso, census, cleveland, dramex, eia, fmp,
                                 fred, ice, kalshi, manheim, miso, mnd, openrouter, pmms, qcew,
                                 sfcompute, treasury, usda, vastai, zillow)
from pipeline.connectors.util import PartialFetchWarning
from pipeline.registry import Series, Source
from pipeline.store import vintage

_KEY_PARAMS = re.compile(r"(api_key|apikey|registrationkey)=[^&\s\"']+", re.IGNORECASE)


def _sanitize(msg: str, secret_values=()) -> str:
    """Redact API keys — error strings are published in sources_status.json."""
    msg = _KEY_PARAMS.sub(r"\1=REDACTED", msg)
    for v in secret_values:
        if v:
            msg = msg.replace(v, "REDACTED")
    return msg


@dataclass(frozen=True)
class SourceResult:
    source: str
    ok: bool
    fetched: int
    new_rows: int
    error: str | None
    finished_at: str  # UTC ISO


def _fred(subset, key, http):
    return fred.fetch([s.source_id for s in subset], key, http_get=http)


def _bls(subset, key, http):
    return bls.fetch([s.source_id for s in subset], key or None, http_post=http)


def _census(subset, key, http):
    return census.fetch([s.source_id for s in subset], http_get=http)


def _eia(subset, key, http):
    return eia.fetch([s.source_id for s in subset], key, http_get=http)


def _fmp(subset, key, http):
    return fmp.fetch([s.source_id for s in subset], key, http_get=http)


def _fmp_eq(subset, key, http):
    return fmp.fetch_equity([s.source_id for s in subset], key, http_get=http)


def _treasury(subset, key, http):
    return treasury.fetch(http_get=http)


def _zillow(subset, key, http):
    return zillow.fetch([s.source_id for s in subset], http_get=http)


def _pmms(subset, key, http):
    return pmms.fetch(http_get=http)


def _aptlist(subset, key, http):
    return aptlist.fetch(http_get=http)


def _usda(subset, key, http):
    return usda.fetch([s.source_id for s in subset], key, http_get=http)


def _aaa(subset, key, http):
    return aaa.fetch(http_get=http)


def _aaa_state(subset, key, http):
    return aaa.fetch_states(http_get=http)


def _mnd(subset, key, http):
    return mnd.fetch(http_get=http)


def _manheim(subset, key, http):
    return manheim.fetch(http_get=http)


def _cleveland(subset, key, http):
    return cleveland.fetch(http_get=http)


def _kalshi(subset, key, http):
    return kalshi.fetch(subset[0].source_id, http_get=http)


def _kalshi_dc(subset, key, http):
    return kalshi.fetch_dc([s.source_id for s in subset], http_get=http)


def _qcew(subset, key, http):
    return qcew.fetch([s.source_id for s in subset], http_get=http)


def _dramex(subset, key, http):
    return dramex.fetch([s.source_id for s in subset], http_get=http)


def _vastai(subset, key, http):
    return vastai.fetch([s.source_id for s in subset], http_get=http)


def _sfcompute(subset, key, http):
    return sfcompute.fetch([s.source_id for s in subset], http_get=http)


def _openrouter(subset, key, http):
    return openrouter.fetch([s.source_id for s in subset], http_get=http)


def _caiso(subset, key, http):
    return caiso.fetch([s.source_id for s in subset], http_get=http)


def _miso(subset, key, http):
    return miso.fetch([s.source_id for s in subset], http_get=http)


def _ice(subset, key, http):
    return ice.fetch([s.source_id for s in subset], http_get=http)


FETCHERS = {"FRED": _fred, "BLS": _bls, "EIA": _eia, "FMP": _fmp,
            # FMP_EQ is a separate source key for failure isolation and its
            # own status row — a broken equity batch (/capacity tracker) must
            # never take down the commodity-futures FMP row (or vice versa).
            "FMP_EQ": _fmp_eq,
            "TREASURY": _treasury, "ZILLOW": _zillow, "PMMS": _pmms,
            "APTLIST": _aptlist, "USDA": _usda, "AAA": _aaa,
            # AAA_STATE is a separate source key for failure isolation and its
            # own status row — a redesigned state-averages page must never take
            # down the national aaa_gas_d row (or vice versa).
            "AAA_STATE": _aaa_state, "MND": _mnd,
            "MANHEIM": _manheim, "CLEVELAND": _cleveland,
            "KALSHI": _kalshi,
            # EIA_STATE is a separate source key only for failure isolation
            # and its own status row — the fetch mechanics are plain EIA.
            "EIA_STATE": _eia, "QCEW": _qcew, "CENSUS": _census,
            "DRAMEX": _dramex, "VASTAI": _vastai, "SFCOMPUTE": _sfcompute,
            "OPENROUTER": _openrouter,
            # STEO is a separate source key only for failure isolation — the
            # fetch mechanics are plain EIA (v2 seriesid route), like EIA_STATE.
            "STEO": _eia,
            "CAISO": _caiso, "MISO": _miso, "ICE": _ice,
            # EIA_SPOT is a separate source key only for failure isolation and
            # its own status row — the fetch mechanics are plain EIA (v2
            # seriesid route), same precedent as EIA_STATE/STEO above.
            "EIA_SPOT": _eia,
            # EIA_STATE_RES is a separate source key only for failure isolation
            # and its own status row — the fetch mechanics are plain EIA (v2
            # seriesid route), same precedent as EIA_STATE/STEO above.
            "EIA_STATE_RES": _eia,
            # KALSHI_DC is a separate source key only for failure isolation —
            # thin speculative DC books must never fail the core KALSHI (CPI)
            # row; fetch_dc's skip semantics differ from fetch()'s by design.
            "KALSHI_DC": _kalshi_dc}

# BLS posts; everything else gets. collect_all passes the right client through.
POST_SOURCES = {"BLS"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def collect_all(sources: dict[str, Source], series: list[Series],
                secrets: dict[str, str], store_dir: Path,
                http_get=None, http_post=None) -> list[SourceResult]:
    results: list[SourceResult] = []
    # One latest-values read for the whole run — append() would otherwise
    # re-read every store partition once per source (~30x).
    latest_cache = vintage.latest_values(store_dir)
    for name, source in sources.items():
        subset = [s for s in series if s.source == name]
        if not subset:
            continue
        key = secrets.get(source.secret, "") if source.secret else ""
        if source.secret and not key and not source.secret_optional:
            results.append(SourceResult(name, False, 0, 0,
                                        f"missing secret {source.secret}", _now()))
            continue
        http = http_post if name in POST_SOURCES else http_get
        try:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", PartialFetchWarning)
                obs = FETCHERS[name](subset, key, http)
            id_map = {s.source_id: s.code for s in subset}
            obs = [replace(o, series_code=id_map.get(o.series_code, o.series_code))
                   for o in obs]
            new = vintage.append(obs, store_dir, latest=latest_cache)
            # Tolerated per-item failures publish alongside ok=True — partial
            # success is not a broken source, but the detail must not vanish.
            partial = "; ".join(str(w.message) for w in caught
                                if issubclass(w.category, PartialFetchWarning))
            error = (f"partial: {_sanitize(partial, secrets.values())}"
                     if partial else None)
            results.append(SourceResult(name, True, len(obs), new, error, _now()))
        except Exception as e:  # isolation boundary: any connector error is contained
            results.append(SourceResult(name, False, 0, 0,
                                        f"{type(e).__name__}: {_sanitize(str(e), secrets.values())}",
                                        _now()))
    return results
