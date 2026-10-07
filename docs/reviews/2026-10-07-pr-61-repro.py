"""Offline PR #61 review probes; no application or store files are modified.

Run: .venv/bin/python docs/reviews/2026-10-07-pr-61-repro.py [git-ref]
Exit 1 denotes reproduced correctness failures, not a test-runner error.
The reviewed compute writer is loaded from the pinned commit. Its unchanged
store/util dependencies come from the checkout; stores are in-memory only.
"""
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
REF = sys.argv[1] if len(sys.argv) > 1 else "360b7a6a0d8fd012b0663ff80c69c6754559697e"
source = subprocess.check_output(
    ["git", "show", f"{REF}:pipeline/publish/compute.py"], cwd=ROOT, text=True
)
compute = types.ModuleType("pr61_compute")
exec(compile(source, "pipeline/publish/compute.py", "exec"), compute.__dict__)
results = []


def check(finding, name, actual, expected):
    results.append(dict(finding=finding, name=name, pass_=actual == expected,
                        actual=actual, expected=expected))


def build(model_prices, cloud_prices=None):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, value REAL, "
                 "vintage_date TEXT, source TEXT, route TEXT)")
    for key, days in model_prices.items():
        for direction in ("in", "out"):
            conn.executemany("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)",
                             [(f"or_{key}_{direction}", d, v, d, "OPENROUTER", "API")
                              for d, v in days.items()])
    for code, days in (cloud_prices or {}).items():
        conn.executemany("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)",
                         [(code, d, v, d, "AWS_GPU", "API") for d, v in days.items()])
    payload = compute.build(conn, staleness={})
    conn.close()
    return payload


old = {k: {"2026-10-05": 1.0, "2026-10-06": 1.0} for k, _ in compute.RETIRED_MODELS}
keys = [k for k, _ in compute.MODELS]

# Control: a complete new roster collected before the retired carry expires.
normal = build({**old, **{k: {"2026-10-07": 2.0, "2026-10-08": 1.0} for k in keys}})
check("control", "Complete overlapping roster rebases and tracks a halving",
      [normal["token_index"]["base_date"], normal["token_index"]["value"]],
      ["2026-10-07", 50.0])

# F1: the inherited browser assertion still requires the old roster's size.
browser_test = subprocess.check_output(
    ["git", "show", f"{REF}:site/e2e/batch4.spec.ts"], cwd=ROOT, text=True
)
expected_count = int(re.search(r"models\.locator\(\"tbody tr\"\)\)\.toHaveCount\((\d+)\)", browser_test)[1])
check("F1", "New writer output satisfies the existing compute browser row-count assertion",
      len(normal["models"]), expected_count)

# F2: the collector explicitly allows missing model IDs; seven new models
# have never been observed. The old roster is still within its carry limit.
partial = build({**old, keys[0]: {"2026-10-07": 2.0, "2026-10-08": 1.0}})
check("F2", "One observed model must not qualify as the complete eight-model roster",
      partial["token_index"]["base_date"], "2026-10-05")
check("F2", "The incomplete-roster fallback remains live during the carry window",
      partial["token_index"]["as_of"], "2026-10-08")
check("control", "The partial store really leaves seven model rows unpriced",
      sum(m["as_of"] is None for m in partial["models"]), 7)

# F3: every current model has prices again, but the retired roster's final
# observation is eight days before the first new observation.
recovered = build({**old, **{k: {"2026-10-14": 2.0, "2026-10-15": 1.0,
                               "2026-10-16": 1.0} for k in keys}})
ti = recovered["token_index"]
history = dict(zip(ti["history"]["dates"], ti["history"]["index"]))
check("F3", "A populated new roster can initialize its own base after a collection gap",
      history["2026-10-14"], 100.0)
check("F3", "Subsequent successful collections recover a live index",
      ti["as_of"], "2026-10-16")
check("control", "All eight new models really are priced after recovery",
      sum(m["as_of"] is not None for m in recovered["models"]), 8)

# F4 diagnostic: there is no freshness suppression in the writer. Whether
# stale observations are usable must therefore be handled by the consumer.
stale = build({}, {"aws_h100": {"2026-10-07": 6.88},
                   "az_h100": {"2026-10-21": 12.29}})
diagnostics = {
    "partial_index": partial["token_index"],
    "recovered_index": ti,
    "old_quote_still_published": next(r for r in stale["cloud_gpus"] if r["code"] == "aws_h100"),
}
failed = sum(not r["pass_"] for r in results)
print(json.dumps(dict(ref=REF, results=results, diagnostics=diagnostics, failed=failed), indent=2))
sys.exit(1 if failed else 0)
