"""Offline PR #124 review probes for head 6a87fa2e35ca0a3dca10a266c906dab36f345ace.

Run against the reviewed source checkout using --repo /path/to/checkout.
Compares the committed store against the shared base engine; writes no data.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import types


def thin(repo):
    from pipeline import dc_markets
    from pipeline.engine import dcmarkets
    from pipeline.publish import dc_markets as writer
    from pipeline.store import vintage

    conn = vintage.load(repo / "store")
    markets = dc_markets.load()
    new = writer._labor(conn, markets, "23")
    original_repo = Path(__file__).resolve().parents[2]
    source = subprocess.check_output([
        "git", "-C", str(original_repo), "show",
        "80c5d80cd3574f860c7e990fcc9b47f6074b9f2e:pipeline/engine/dcmarkets.py"], text=True)
    old_module = types.ModuleType("review_base_engine")
    exec(compile(source, "base-dcmarkets.py", "exec"), old_module.__dict__)
    writer.dcmarkets = old_module
    try:
        old = writer._labor(conn, markets, "23")
    finally:
        writer.dcmarkets = dcmarkets
    diffs = [{"market": after["key"], "changes": {
        k: {"before": before[k], "after": after[k]}
        for k in after if before[k] != after[k]}}
        for before, after in zip(old["markets"], new["markets"])
        if before != after]
    assert diffs == [{"market": "richland", "changes": {
        "thin_base": {"before": False, "after": True}}}]
    return {"as_of": new["as_of"], "market_count": len(new["markets"]),
            "changed_rows": diffs}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--mode", choices=('thin',), default='thin')
    args = parser.parse_args()
    args.repo = args.repo.resolve()
    sys.path.insert(0, str(args.repo))
    os.chdir(args.repo)
    result = thin(args.repo)
    print(json.dumps(result, indent=2))
