import json
from pathlib import Path

import pytest

from pipeline.models import Observation
from pipeline.store import vintage


def obs(code="CPIAUCNS", date="2026-05-01", value=320.5, vintage="2026-07-07"):
    return Observation(series_code=code, obs_date=date, value=value,
                       vintage_date=vintage, source="FRED", route="API")


def test_append_writes_monthly_partition(tmp_path):
    n = vintage.append([obs()], tmp_path)
    assert n == 1
    part = tmp_path / "obs" / "2026-07.jsonl"
    assert part.exists()
    row = json.loads(part.read_text().strip())
    assert row == {"series_code": "CPIAUCNS", "obs_date": "2026-05-01",
                   "value": 320.5, "vintage_date": "2026-07-07",
                   "source": "FRED", "route": "API"}


def test_append_dedupes_same_value(tmp_path):
    vintage.append([obs()], tmp_path)
    n = vintage.append([obs(vintage="2026-07-08")], tmp_path)  # same value, new day
    assert n == 0
    lines = (tmp_path / "obs" / "2026-07.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1


def test_append_keeps_revisions(tmp_path):
    vintage.append([obs(value=320.5)], tmp_path)
    n = vintage.append([obs(value=321.0, vintage="2026-08-02")], tmp_path)
    assert n == 1
    assert (tmp_path / "obs" / "2026-08.jsonl").exists()


def test_load_and_latest_vintage_wins(tmp_path):
    vintage.append([obs(date="2026-04-01", value=319.0),
                    obs(date="2026-05-01", value=320.5)], tmp_path)
    vintage.append([obs(date="2026-04-01", value=319.2, vintage="2026-08-02")], tmp_path)
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "CPIAUCNS") == [("2026-04-01", 319.2),
                                                ("2026-05-01", 320.5)]
    assert vintage.max_vintage(conn, "CPIAUCNS") == "2026-08-02"


def test_max_vintage_unknown_series_raises(tmp_path):
    vintage.append([obs()], tmp_path)
    conn = vintage.load(tmp_path)
    with pytest.raises(ValueError):
        vintage.max_vintage(conn, "NO_SUCH_SERIES")


def test_load_tolerates_rows_missing_future_fields(tmp_path):
    part = tmp_path / "obs" / "2026-07.jsonl"
    part.parent.mkdir(parents=True)
    part.write_text(
        '{"series_code": "OLD", "obs_date": "2026-05-01", "value": 1.5,'
        ' "vintage_date": "2026-07-07"}\n')  # no source/route — legacy row
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "OLD") == [("2026-05-01", 1.5)]
    row = conn.execute("SELECT source, route FROM observations").fetchone()
    assert row == (None, None)


def test_append_vintages_writes_equal_value_at_earlier_vintage(tmp_path):
    # the daily snapshot already holds today's value; a historical backfill
    # must still land the first-release row even though the value is identical
    # (value-dedupe in append() would wrongly skip it)
    vintage.append([obs(date="2025-05-01", value=313.6, vintage="2026-07-13")], tmp_path)
    n = vintage.append_vintages(
        [obs(date="2025-05-01", value=313.6, vintage="2025-06-11")], tmp_path)
    assert n == 1
    assert (tmp_path / "obs" / "2025-06.jsonl").exists()
    conn = vintage.load(tmp_path)
    assert vintage.first_releases(conn, "CPIAUCNS") == [
        ("2025-05-01", 313.6, "2025-06-11")]
    # latest-vintage-wins view is unchanged by the backfill
    assert vintage.latest(conn, "CPIAUCNS") == [("2025-05-01", 313.6)]


def test_append_vintages_is_idempotent(tmp_path):
    rows = [obs(date="2025-05-01", value=313.6, vintage="2025-06-11"),
            obs(date="2025-04-01", value=313.0, vintage="2025-05-13")]
    assert vintage.append_vintages(rows, tmp_path) == 2
    assert vintage.append_vintages(rows, tmp_path) == 0
    lines = (tmp_path / "obs" / "2025-06.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1


def test_max_obs_date(tmp_path):
    vintage.append([obs(date="2026-04-01"), obs(date="2026-05-01")], tmp_path)
    conn = vintage.load(tmp_path)
    assert vintage.max_obs_date(conn, "CPIAUCNS") == "2026-05-01"
    assert vintage.max_obs_date(conn, "NO_SUCH_SERIES") is None
