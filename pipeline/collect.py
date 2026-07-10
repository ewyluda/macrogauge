"""Fan-out collection with per-connector failure isolation.

A broken source records an error in its SourceResult (surfaced via
sources_status.json and QA) and lowers freshness — it never blocks the run.
The store's carry-forward semantics make a missed day harmless.
"""
import re
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from pipeline.connectors import (aaa, aptlist, bls, eia, fmp, fred, manheim, mnd, pmms,
                                 treasury, usda, zillow)
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


def _eia(subset, key, http):
    return eia.fetch([s.source_id for s in subset], key, http_get=http)


def _fmp(subset, key, http):
    return fmp.fetch([s.source_id for s in subset], key, http_get=http)


def _treasury(subset, key, http):
    return treasury.fetch(http_get=http)


def _zillow(subset, key, http):
    return zillow.fetch(http_get=http)


def _pmms(subset, key, http):
    return pmms.fetch(http_get=http)


def _aptlist(subset, key, http):
    return aptlist.fetch(http_get=http)


def _usda(subset, key, http):
    return usda.fetch([s.source_id for s in subset], key, http_get=http)


def _aaa(subset, key, http):
    return aaa.fetch(http_get=http)


def _mnd(subset, key, http):
    return mnd.fetch(http_get=http)


def _manheim(subset, key, http):
    return manheim.fetch(http_get=http)


FETCHERS = {"FRED": _fred, "BLS": _bls, "EIA": _eia, "FMP": _fmp,
            "TREASURY": _treasury, "ZILLOW": _zillow, "PMMS": _pmms,
            "APTLIST": _aptlist, "USDA": _usda, "AAA": _aaa, "MND": _mnd,
            "MANHEIM": _manheim}

# BLS posts; everything else gets. collect_all passes the right client through.
POST_SOURCES = {"BLS"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def collect_all(sources: dict[str, Source], series: list[Series],
                secrets: dict[str, str], store_dir: Path,
                http_get=None, http_post=None) -> list[SourceResult]:
    results: list[SourceResult] = []
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
            obs = FETCHERS[name](subset, key, http)
            id_map = {s.source_id: s.code for s in subset}
            obs = [replace(o, series_code=id_map.get(o.series_code, o.series_code))
                   for o in obs]
            new = vintage.append(obs, store_dir)
            results.append(SourceResult(name, True, len(obs), new, None, _now()))
        except Exception as e:  # isolation boundary: any connector error is contained
            results.append(SourceResult(name, False, 0, 0,
                                        f"{type(e).__name__}: {_sanitize(str(e), secrets.values())}",
                                        _now()))
    return results
