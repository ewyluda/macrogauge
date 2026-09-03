"""Writer for ledger.json — what the site said on every publish, never
restated (batch 5c, 2026-09-03).

The vintage store proves what INPUTS we had on a day; a claims reader
needs what we PUBLISHED. This is an append-only ledger under
store/ledger/pulse.jsonl: one row per publish, written after every other
phase from the artifacts on disk (pulse.json, gaptable.json,
datacenter.json), keyed by published_at so a re-run never duplicates a
row. Rows are immutable — the row-evolution policy in README applies
(fields add-only; readers default absent fields to None). ledger.json
publishes every row; a few KB a year.

scripts/backfill_ledger.py seeds the ledger from the git history of
pulse.json (every daily commit since 2026-07-08) using the same row
builder, so backfilled and live rows share one shape.
"""
import json
from pathlib import Path

from pipeline.publish.util import write_json

LEDGER_SUBDIR = "ledger"
LEDGER_FILE = "pulse.jsonl"
VARIANTS = ("gauge", "tracker", "col", "supercore", "pce")
DC = ("build", "ops", "hardware")


def row_from_artifacts(pulse: dict | None, gaptable: dict | None,
                       datacenter: dict | None) -> dict | None:
    """One ledger row from the three artifacts (dicts, any of which may be
    None). None when there is no pulse (nothing was published)."""
    if not pulse or not pulse.get("published_at"):
        return None
    variants = (gaptable or {}).get("variants", {}) if gaptable else {}
    idx = (datacenter or {}).get("indexes", {}) if datacenter else {}
    row = {"published_at": pulse["published_at"], "date": pulse["published_at"][:10]}
    for v in VARIANTS:
        block = pulse.get(v) if v in ("gauge", "tracker") else variants.get(v)
        row[f"{v}_yoy_pct"] = block.get("yoy_pct") if block else None
        row[f"{v}_as_of"] = block.get("as_of") if block else None
    off = pulse.get("official") or {}
    row["official_month"] = off.get("month")
    row["official_yoy_pct"] = off.get("yoy_pct")
    row["coverage_pct"] = (pulse.get("gauge") or {}).get("coverage_pct")
    for k in DC:
        row[f"dc_{k}_yoy_pct"] = (idx.get(k) or {}).get("headline_yoy_pct")
        row[f"dc_{k}_as_of"] = (idx.get(k) or {}).get("as_of")
    return row


def _read(out_dir: Path, name: str) -> dict | None:
    p = out_dir / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def ledger_path(store_dir: Path) -> Path:
    return store_dir / LEDGER_SUBDIR / LEDGER_FILE


def read_rows(store_dir: Path) -> list[dict]:
    p = ledger_path(store_dir)
    if not p.exists():
        return []
    rows = [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
    # last-seen wins per published_at (union-merge of concurrent commits)
    by = {}
    for r in rows:
        by[r["published_at"]] = r
    return [by[k] for k in sorted(by)]


def append_row(row: dict, store_dir: Path) -> bool:
    """Append unless a row with this published_at exists. Returns True if written."""
    existing = {r["published_at"] for r in read_rows(store_dir)}
    if row["published_at"] in existing:
        return False
    p = ledger_path(store_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a") as f:
        f.write(json.dumps(row, sort_keys=True) + "\n")
    return True


def build(store_dir: Path, out_dir: Path) -> dict:
    """Append today's row from the artifacts just written, then publish every row."""
    row = row_from_artifacts(_read(out_dir, "pulse.json"), _read(out_dir, "gaptable.json"),
                             _read(out_dir, "datacenter.json"))
    appended = append_row(row, store_dir) if row else False
    rows = read_rows(store_dir)
    return {"appended_today": appended,
            "first_publish": rows[0]["published_at"] if rows else None,
            "rows": rows}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "ledger.json")
