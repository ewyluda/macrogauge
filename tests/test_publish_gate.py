import json
import subprocess
from datetime import datetime

import pytest

from pipeline import publish_gate, watchdog
from pipeline.publish_gate import decide


@pytest.mark.parametrize("event", ["workflow_dispatch", "push"])
def test_manual_events_always_run(event):
    assert decide(event, 3, True, False)[0] is True


@pytest.mark.parametrize("hour,expected", [(7, False), (8, True), (15, True),
                                           (16, True), (21, True), (22, False)])
def test_window_bounds(hour, expected):
    assert decide("schedule", hour, False, False)[0] is expected


def test_late_slip_still_publishes():
    # 2026-08-28: every firing landed 18:35-19:11 ET under the old 15:59 cutoff
    run, reason = decide("schedule", 18, False, False)
    assert run and reason == "first publish today"


def test_repository_dispatch_is_gated_like_schedule():
    assert decide("repository_dispatch", 12, True, False) == (False, "already published today")


def test_release_day_guard_republishes():
    assert decide("schedule", 13, True, True)[0] is True


def _repo(tmp_path, subjects):
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=tmp_path, check=True)
    for s in subjects:
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit",
                        "-q", "--allow-empty", "-m", s], cwd=tmp_path, check=True)
    return tmp_path


def test_published_on_reads_the_given_ref(tmp_path):
    repo = _repo(tmp_path, ["data: daily publish 2026-09-25 13:35 ET", "feat: x"])
    assert publish_gate.published_on("2026-09-25", "main", cwd=repo)
    assert not publish_gate.published_on("2026-09-26", "main", cwd=repo)


@pytest.mark.parametrize("now,expected", [
    ("2026-09-25T22:30:00-04:00", "2026-09-25"),  # Fri after window close
    ("2026-09-25T20:00:00-04:00", "2026-09-24"),  # Fri, window still open
    ("2026-09-26T01:15:00-04:00", "2026-09-25"),  # Sat early -> Fri
    ("2026-09-28T02:00:00-04:00", "2026-09-25"),  # Mon early -> Fri
])
def test_last_closed_weekday(now, expected):
    assert watchdog.last_closed_weekday(
        datetime.fromisoformat(now).astimezone(watchdog.ET)).isoformat() == expected


def test_watchdog_flags_missing_publish_and_critical_qa(tmp_path, monkeypatch, capsys):
    repo = _repo(tmp_path, ["data: daily publish 2026-09-24 13:36 ET"])
    qa = repo / "qa.json"
    qa.write_text(json.dumps({"checks": [
        {"name": "gauge_current", "critical": True, "pass": False, "detail": "9d old"},
        {"name": "sources_fresh", "critical": False, "pass": False, "detail": "x"}]}))
    monkeypatch.chdir(repo)
    rc = watchdog.main(["--qa", str(qa), "--ref", "main",
                        "--now", "2026-09-25T23:00:00-04:00"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "no 'data: daily publish 2026-09-25' commit" in out
    assert "gauge_current" in out and "sources_fresh" not in out


def test_watchdog_ok(tmp_path, monkeypatch):
    repo = _repo(tmp_path, ["data: daily publish 2026-09-25 13:36 ET"])
    qa = repo / "qa.json"
    qa.write_text(json.dumps({"checks": [{"name": "a", "critical": True, "pass": True}]}))
    monkeypatch.chdir(repo)
    assert watchdog.main(["--qa", str(qa), "--ref", "main",
                          "--now", "2026-09-25T23:00:00-04:00"]) == 0
