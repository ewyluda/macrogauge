"""Injected-HTTP test for the one-shot unfilled-orders history backfill."""
import pytest

from scripts import backfill_uo_history
from pipeline.store import vintage

DEEP = [
    {"date": "1992-01-01", "value": "1000.0"},
    {"date": "1992-02-01", "value": "1010.0"},
    {"date": "2026-05-01", "value": "5000.0"},
]
# starts 2017-01 instead of 1992-01: a plausible-looking response that would
# silently shorten the whole lead-lag study's sample by 25 years
SHALLOW = [
    {"date": "2017-01-01", "value": "3000.0"},
    {"date": "2026-05-01", "value": "5000.0"},
]


class FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def make_get(seen: list, fail=(), empty=(), shallow=(), dotted=()):
    """Fake FRED. Each set names FRED source_ids to degrade one of the four
    ways fred.fetch can come back short WITHOUT raising: a failed request, an
    empty observations list, rows whose values are all "." (fetch filters
    them, so the series yields nothing), and history that starts later than
    asked for."""
    def fake_get(url, params=None, timeout=None):
        seen.append(params)
        sid = params["series_id"]
        if sid in fail:
            raise RuntimeError(f"simulated FRED failure for {sid}")
        if sid in empty:
            return FakeResp({"observations": []})
        if sid in dotted:
            return FakeResp({"observations": [
                {"date": d["date"], "value": "."} for d in DEEP]})
        if sid in shallow:
            return FakeResp({"observations": list(SHALLOW)})
        return FakeResp({"observations": list(DEEP)})
    return fake_get


def test_backfill_writes_internal_codes_not_fred_ids(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    rc = backfill_uo_history.main(
        ["--store", str(tmp_path)], http_get=make_get(seen))
    assert rc == 0

    conn = vintage.load(tmp_path)
    # internal codes, not U35CUO / U33HUO / UTGPUO
    assert dict(vintage.latest(conn, "fred_uo_electrical"))["1992-01-01"] == 1000.0
    assert dict(vintage.latest(conn, "fred_uo_hvac"))["1992-02-01"] == 1010.0
    assert vintage.latest(conn, "U35CUO") == []
    assert vintage.latest(conn, "U33HUO") == []


def test_backfill_requests_deep_observation_start(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_uo_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert seen, "no HTTP calls made"
    assert all(p["observation_start"] == "1992-01-01" for p in seen)


def test_backfill_covers_all_three_series(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_uo_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert {p["series_id"] for p in seen} == {"U35CUO", "U33HUO", "UTGPUO"}


def test_backfill_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_uo_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    before = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    backfill_uo_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    after = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    assert before == after, "re-running the backfill must be a no-op"


# --- coverage validation -------------------------------------------------
# fred.fetch tolerates per-series failures by design: it collects errors and
# only raises when EVERY series failed. So 2 of 3 succeeding returns
# normally. That must not read as success here -- a shallow driver silently
# caps dcleadlag.study()'s sample at whatever depth came back, while the
# script exits 0.

def test_backfill_fails_when_one_series_request_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_uo_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], fail={"U35CUO"}))
    msg = str(e.value)
    assert "fred_uo_electrical" in msg, msg
    assert "no rows" in msg, msg


def test_backfill_fails_when_one_series_returns_no_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_uo_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], empty={"U33HUO"}))
    assert "fred_uo_hvac" in str(e.value)


def test_backfill_fails_when_every_row_is_a_dot(tmp_path, monkeypatch):
    """FRED marks unavailable observations "."; fred.fetch filters them, so a
    series can return HTTP 200 with rows and still yield nothing."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_uo_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], dotted={"UTGPUO"}))
    assert "fred_uo_turbines" in str(e.value)
    assert not list((tmp_path / "obs").glob("*.jsonl"))


def test_backfill_fails_when_one_series_lacks_the_requested_depth(
        tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_uo_history.main(
            ["--store", str(tmp_path)],
            http_get=make_get([], shallow={"U35CUO"}))
    msg = str(e.value)
    assert "fred_uo_electrical" in msg, msg
    assert "2017-01-01" in msg and "1992-01-01" in msg, msg


def test_backfill_writes_nothing_when_coverage_is_incomplete(
        tmp_path, monkeypatch):
    """Validation must run BEFORE the append -- a partial backfill in the
    store is worse than none, because the store is append-only."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit):
        backfill_uo_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], fail={"U35CUO"}))
    assert not list((tmp_path / "obs").glob("*.jsonl")), (
        "store was written despite incomplete coverage")


def test_backfill_honours_a_custom_observation_start(tmp_path, monkeypatch):
    """The depth requirement tracks --observation-start, not a hardcoded date:
    the SHALLOW fixture starts 2017-01, so asking for 2017-01 must pass."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    rc = backfill_uo_history.main(
        ["--store", str(tmp_path), "--observation-start", "2017-01-01"],
        http_get=make_get([], shallow={"U35CUO"}))
    assert rc == 0


def test_backfill_reports_per_series_coverage_on_success(
        tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_uo_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    out = capsys.readouterr().out
    for code in backfill_uo_history.SERIES_CODES:
        assert code in out, f"{code} missing from coverage report:\n{out}"
    assert out.count("1992-01-01") >= 1, out


def test_backfill_fails_when_series_missing_from_registry(tmp_path, monkeypatch):
    """The registry check is a real guard, not dead code: point at a series
    list containing a code the registry doesn't have, and confirm it exits
    with a clear message rather than proceeding or KeyError-ing."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr(backfill_uo_history, "SERIES_CODES",
                        ["fred_uo_electrical", "not_a_real_series_code"])
    with pytest.raises(SystemExit) as e:
        backfill_uo_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    assert "not_a_real_series_code" in str(e.value)
