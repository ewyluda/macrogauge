"""One-shot: seed store/ledger/pulse.jsonl from the git history of the
published artifacts (batch 5c). Every daily commit since 2026-07-08 carries
pulse.json; gaptable.json and datacenter.json appear when their phases
shipped and are null before that. Uses ledger.row_from_artifacts so backfilled
rows share the live row's shape. Idempotent: append_row dedupes by
published_at. Run from the repo root:

    python scripts/backfill_ledger.py [--store store]
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.publish import ledger  # noqa: E402

DATA = "site/public/data"


def _show(sha: str, name: str) -> dict | None:
    r = subprocess.run(["git", "show", f"{sha}:{DATA}/{name}"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", type=Path, default=Path("store"))
    args = ap.parse_args(argv)
    shas = subprocess.run(["git", "log", "--reverse", "--format=%H", "--", f"{DATA}/pulse.json"],
                          capture_output=True, text=True, check=True).stdout.split()
    written = skipped = 0
    for sha in shas:
        row = ledger.row_from_artifacts(_show(sha, "pulse.json"), _show(sha, "gaptable.json"),
                                        _show(sha, "datacenter.json"))
        if row is None:
            skipped += 1
            continue
        if ledger.append_row(row, args.store):
            written += 1
        else:
            skipped += 1
    print(f"ledger: {written} rows written, {skipped} skipped, "
          f"{len(ledger.read_rows(args.store))} total at {ledger.ledger_path(args.store)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
