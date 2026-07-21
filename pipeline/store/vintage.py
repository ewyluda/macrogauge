"""Append-only vintage observation store: JSONL partitioned by vintage month.

Re-published values append a new vintage row — never overwrite. History
can't be silently rewritten; git is the audit trail.

Row-evolution policy: rows are immutable and schema-versionless. New fields
may be ADDED to Observation; fields are never renamed, removed, or retyped,
and their meaning never changes. Readers default absent fields to None, so
partitions written by any past version load forever.
"""
import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

from pipeline.models import Observation

OBS_SUBDIR = "obs"
COLUMNS = ("series_code", "obs_date", "value", "vintage_date", "source", "route")


def _partitions(store_dir: Path) -> list[Path]:
    d = store_dir / OBS_SUBDIR
    return sorted(d.glob("*.jsonl")) if d.exists() else []


def _latest_values(store_dir: Path) -> dict[tuple[str, str], float]:
    """Latest stored value per (series_code, obs_date), by vintage then file order."""
    latest: dict[tuple[str, str], float] = {}
    latest_vintage: dict[tuple[str, str], str] = {}
    for part in _partitions(store_dir):
        for line in part.read_text().splitlines():
            row = json.loads(line)
            key = (row["series_code"], row["obs_date"])
            if key not in latest_vintage or row["vintage_date"] >= latest_vintage[key]:
                latest_vintage[key] = row["vintage_date"]
                latest[key] = row["value"]
    return latest


def latest_values(store_dir: Path) -> dict[tuple[str, str], float]:
    """Public seed for append()'s latest cache — build once, share across the
    per-source append calls in collect_all instead of re-reading every
    partition for each of the ~30 sources."""
    return _latest_values(store_dir)


def append(observations: list[Observation], store_dir: Path,
           latest: dict[tuple[str, str], float] | None = None) -> int:
    """Append observations whose value differs from the latest stored one.

    A caller-provided `latest` cache (from latest_values) is used AND
    updated in place, so successive appends against one cache stay
    consistent without re-reading the store each time."""
    if latest is None:
        latest = _latest_values(store_dir)
    written = 0
    for o in observations:
        if latest.get((o.series_code, o.obs_date)) == o.value:
            continue
        part = store_dir / OBS_SUBDIR / f"{o.vintage_date[:7]}.jsonl"
        part.parent.mkdir(parents=True, exist_ok=True)
        with part.open("a") as f:
            f.write(json.dumps(asdict(o), sort_keys=True) + "\n")
        latest[(o.series_code, o.obs_date)] = o.value
        written += 1
    return written


def append_vintages(observations: list[Observation], store_dir: Path) -> int:
    """Append historical-vintage rows, deduped by identity, not value.

    append()'s value-dedupe is wrong for backfills: a first release whose
    value never changed would be skipped because the daily snapshot already
    holds it — losing the release date that vintage-true grading needs. Here
    a row is skipped only if the exact (series, obs_date, vintage) is already
    stored, so re-running a backfill is a no-op."""
    seen = {(row["series_code"], row["obs_date"], row["vintage_date"])
            for part in _partitions(store_dir)
            for row in map(json.loads, part.read_text().splitlines())}
    written = 0
    for o in observations:
        key = (o.series_code, o.obs_date, o.vintage_date)
        if key in seen:
            continue
        part = store_dir / OBS_SUBDIR / f"{o.vintage_date[:7]}.jsonl"
        part.parent.mkdir(parents=True, exist_ok=True)
        with part.open("a") as f:
            f.write(json.dumps(asdict(o), sort_keys=True) + "\n")
        seen.add(key)
        written += 1
    return written


def load(store_dir: Path) -> sqlite3.Connection:
    """Load all partitions into an in-memory SQLite database."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    conn.execute("CREATE INDEX idx_series ON observations (series_code, obs_date)")
    for part in _partitions(store_dir):
        rows = [{c: row.get(c) for c in COLUMNS}
                for row in (json.loads(line) for line in part.read_text().splitlines())]
        conn.executemany(
            "INSERT INTO observations VALUES "
            "(:series_code, :obs_date, :value, :vintage_date, :source, :route)", rows)
    conn.commit()
    return conn


def latest(conn: sqlite3.Connection, series_code: str) -> list[tuple[str, float]]:
    """(obs_date, value) ascending; latest vintage wins per obs_date."""
    return conn.execute("""
        SELECT obs_date, value FROM (
            SELECT obs_date, value, ROW_NUMBER() OVER (
                PARTITION BY obs_date ORDER BY vintage_date DESC, rowid DESC) rn
            FROM observations WHERE series_code = ?)
        WHERE rn = 1 ORDER BY obs_date""", (series_code,)).fetchall()


def as_of(conn: sqlite3.Connection, series_code: str,
          vintage_date: str) -> list[tuple[str, float]]:
    """Vintage-true series view using only information known by ``vintage_date``."""
    return conn.execute("""
        SELECT obs_date, value FROM (
            SELECT obs_date, value, ROW_NUMBER() OVER (
                PARTITION BY obs_date ORDER BY vintage_date DESC, rowid DESC) rn
            FROM observations
            WHERE series_code = ? AND vintage_date <= ?)
        WHERE rn = 1 ORDER BY obs_date""", (series_code, vintage_date)).fetchall()


def first_releases(conn: sqlite3.Connection,
                   series_code: str) -> list[tuple[str, float, str]]:
    """First stored release for each observation: (obs_date, value, vintage_date)."""
    return conn.execute("""
        SELECT obs_date, value, vintage_date FROM (
            SELECT obs_date, value, vintage_date, ROW_NUMBER() OVER (
                PARTITION BY obs_date ORDER BY vintage_date ASC, rowid ASC) rn
            FROM observations WHERE series_code = ?)
        WHERE rn = 1 ORDER BY obs_date""", (series_code,)).fetchall()


def max_vintage(conn: sqlite3.Connection, series_code: str) -> str:
    row = conn.execute("SELECT MAX(vintage_date) FROM observations WHERE series_code = ?",
                       (series_code,)).fetchone()
    if row[0] is None:
        raise ValueError(f"no observations for {series_code}")
    return row[0]


def max_obs_date(conn: sqlite3.Connection, series_code: str) -> str | None:
    """Most recent obs_date for a series; None when the series has no rows.

    Unlike max_vintage (raises for unknown series), freshness checks treat
    'never seen' as a reportable value, not an error.
    """
    row = conn.execute("SELECT MAX(obs_date) FROM observations WHERE series_code = ?",
                       (series_code,)).fetchone()
    return row[0]
