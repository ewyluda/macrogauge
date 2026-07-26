"""Injected-HTTP test for the one-shot DC history backfill."""
import pytest

from scripts import backfill_dc_history
from pipeline.store import vintage

DEEP = [
    {"date": "2007-12-01", "value": "100.0"},
    {"date": "2008-01-01", "value": "101.0"},
    {"date": "2026-06-01", "value": "150.0"},
]
# starts 2017-01 instead of 2007-12: a plausible-looking response that would
# silently shorten the whole Build index (headline intersects component dates)
SHALLOW = [
    {"date": "2017-01-01", "value": "120.0"},
    {"date": "2026-06-01", "value": "150.0"},
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
    rc = backfill_dc_history.main(
        ["--store", str(tmp_path)], http_get=make_get(seen))
    assert rc == 0

    conn = vintage.load(tmp_path)
    # internal codes, not WPU1017 / CES2000000003
    assert dict(vintage.latest(conn, "ppi_steel"))["2007-12-01"] == 100.0
    assert dict(vintage.latest(conn, "ces_constr_ahe"))["2008-01-01"] == 101.0
    assert vintage.latest(conn, "WPU1017") == []
    assert vintage.latest(conn, "CES2000000003") == []


def test_backfill_requests_deep_observation_start(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert seen, "no HTTP calls made"
    assert all(p["observation_start"] == "2007-12-01" for p in seen)


def test_backfill_covers_all_twelve_build_components(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert {p["series_id"] for p in seen} == {
        "CES2000000003", "PCU23821X23821X", "PCU23822X23822X", "WPU1017",
        "PCU327320327320", "WPU10260314", "WPU102501", "WPU1175", "WPU1174",
        "PCU333611333611", "PCU333415333415", "WPU1141"}


def test_backfill_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    before = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    after = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    assert before == after, "re-running the backfill must be a no-op"


# --- coverage validation -------------------------------------------------
# fred.fetch tolerates per-series failures by design: it collects errors and
# only raises when EVERY series failed. So 11 of 12 succeeding returns
# normally. That must not read as success here — the Build headline is the
# intersection of its components' dates, so one short component silently
# drags the whole index back to a 2017 start and the GFC basis disappears
# from /escalation while the script exits 0.

def test_backfill_fails_when_one_series_request_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_dc_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], fail={"WPU1017"}))
    msg = str(e.value)
    assert "ppi_steel" in msg, msg
    assert "no rows" in msg, msg


def test_backfill_fails_when_one_series_returns_no_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_dc_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], empty={"WPU1174"}))
    assert "ppi_transformer" in str(e.value)


def test_backfill_fails_when_every_row_is_a_dot(tmp_path, monkeypatch):
    """FRED marks unavailable observations "."; fred.fetch filters them, so a
    series can return HTTP 200 with rows and still yield nothing."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_dc_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], dotted={"WPU1141"}))
    assert "ppi_pumps" in str(e.value)
    assert not list((tmp_path / "obs").glob("*.jsonl"))


def test_backfill_fails_when_one_series_lacks_the_requested_depth(
        tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_dc_history.main(
            ["--store", str(tmp_path)],
            http_get=make_get([], shallow={"PCU23821X23821X"}))
    msg = str(e.value)
    # the SERIES code (ppi_elec_contr), not the basket component code
    assert "ppi_elec_contr" in msg, msg
    assert "2017-01-01" in msg and "2007-12-01" in msg, msg


def test_backfill_writes_nothing_when_coverage_is_incomplete(
        tmp_path, monkeypatch):
    """Validation must run BEFORE the append — a partial backfill in the
    store is worse than none, because the store is append-only."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit):
        backfill_dc_history.main(["--store", str(tmp_path)],
                                 http_get=make_get([], fail={"WPU1017"}))
    assert not list((tmp_path / "obs").glob("*.jsonl")), (
        "store was written despite incomplete coverage")


def test_backfill_honours_a_custom_observation_start(tmp_path, monkeypatch):
    """The depth requirement tracks --observation-start, not a hardcoded date:
    the SHALLOW fixture starts 2017-01, so asking for 2017-01 must pass."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    rc = backfill_dc_history.main(
        ["--store", str(tmp_path), "--observation-start", "2017-01-01"],
        http_get=make_get([], shallow={"PCU23821X23821X"}))
    assert rc == 0


def test_backfill_reports_per_series_coverage_on_success(
        tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    out = capsys.readouterr().out
    # all twelve series named, each with the earliest date it actually returned
    for code in backfill_dc_history.build_series_codes():
        assert code in out, f"{code} missing from coverage report:\n{out}"
    assert out.count("2007-12-01") >= 12, out
