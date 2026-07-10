"""Scrape-failure drill (spec 2a §7): run the daily pipeline with every scrape
domain refusing connections AND scrape history stripped from a store COPY.
Asserts graceful degradation; never touches the real store or site data.

    set -a; source .env; set +a
    python scripts/drill_scrapes.py
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

import requests

from pipeline import run_daily

SCRAPE_DOMAINS = ("gasprices.aaa.com", "mortgagenewsdaily.com", "manheim.com")
SCRAPE_SERIES = {"aaa_gas_d", "mnd_30y_d", "manheim_uvvi_m"}


def blocking_get(url, **kw):
    if any(d in url for d in SCRAPE_DOMAINS):
        raise requests.ConnectionError(f"drill: blocked {url}")
    return requests.get(url, **kw)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="drill-"))
    store, out = tmp / "store", tmp / "out"
    shutil.copytree("store", store)
    for part in (store / "obs").glob("*.jsonl"):
        rows = [ln for ln in part.read_text().splitlines()
                if json.loads(ln)["series_code"] not in SCRAPE_SERIES]
        part.write_text("\n".join(rows) + ("\n" if rows else ""))
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=blocking_get)
    status = json.loads((out / "sources_status.json").read_text())
    qa = json.loads((out / "qa.json").read_text())
    # sources_status.json rows use field `name` (not `source`): {name, route,
    # cadence, ok, fetched, new_rows, error, finished_at, series_count, latest_obs}.
    failed = {s["name"] for s in status["sources"] if not s["ok"]}
    assert rc == 0, f"run failed rc={rc}"
    assert {"AAA", "MND", "MANHEIM"} <= failed, f"expected scrape failures, got {failed}"
    published = sorted(p.name for p in out.glob("*.json"))
    # 13 published files: compare, gaptable, gauge_daily, grocery_basket,
    # methodology, official, pulse, qa, quilt_months_{24,48,all}, replay,
    # sources_status. (Brief said 14 — actual publish count is 13.)
    assert len(published) == 13, f"expected 13 files, got {len(published)}: {published}"
    engine_ok = next(c for c in qa["checks"] if c["name"] == "engine_ok")
    assert engine_ok["pass"], engine_ok
    print(f"DRILL PASS — failures surfaced: {sorted(failed)}; "
          f"13 files published; qa {qa['passed']}/{qa['total']}")

    # Extra evidence for the report: gauge coverage (pulse.json), per-component
    # mode for fuel/used_vehicles (methodology.json — fuel's EIA leg should
    # keep it live; used_vehicles has no other leg and should fall to
    # bls_cf), and gate status (qa.json's gauge_components_present detail
    # only appends "; gated today — ..." when gate_flags is non-empty).
    pulse = json.loads((out / "pulse.json").read_text())
    methodology = json.loads((out / "methodology.json").read_text())
    modes = {c["code"]: c["mode"] for c in methodology["basket"]}
    print(f"gauge coverage_pct={pulse['gauge']['coverage_pct']}; "
          f"fuel mode={modes.get('fuel')}; "
          f"used_vehicles mode={modes.get('used_vehicles')}")
    connectors_ok = next(c for c in qa["checks"] if c["name"] == "connectors_ok")
    print(f"qa connectors_ok: {connectors_ok}")
    gate_check = next(c for c in qa["checks"] if c["name"] == "gauge_components_present")
    print(f"qa gauge_components_present (gate evidence): {gate_check}")
    shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
