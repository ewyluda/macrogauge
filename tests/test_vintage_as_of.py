import sqlite3

from pipeline.store import vintage


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, value REAL, vintage_date TEXT, source TEXT, route TEXT)")
    conn.executemany("INSERT INTO observations VALUES (?, ?, ?, ?, 'FRED', 'API')", [
        ("X", "2026-01-01", 100, "2026-02-01"),
        ("X", "2026-01-01", 101, "2026-03-01"),
    ])
    return conn


def test_as_of_excludes_future_revision():
    assert vintage.as_of(_conn(), "X", "2026-02-15") == [("2026-01-01", 100.0)]


def test_first_releases_preserves_initial_value():
    assert vintage.first_releases(_conn(), "X") == [("2026-01-01", 100.0, "2026-02-01")]
