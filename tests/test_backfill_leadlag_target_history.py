"""Injected-HTTP test for the deep-history backfill of the four Build PPI
components dcleadlag.MAPPINGS correlates against (the "target" side of P3c)."""
import pytest

from scripts import backfill_leadlag_target_history
from pipeline.store import vintage

DEEP = [
    {"date": "1992-01-01", "value": "100.0"},
    {"date": "1992-02-01", "value": "100.5"},
    {"date": "2026-06-01", "value": "300.0"},
]
# starts 2007-01 instead of 1992-01: what's already in the store today -- a
# plausible-looking response that would silently leave the study's common
# sample exactly where it already is
SHALLOW = [
    {"date": "2007-01-01", "value": "185.4"},
    {"date": "2026-06-01", "value": "300.0"},
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
    rc = backfill_leadlag_target_history.main(
        ["--store", str(tmp_path)], http_get=make_get(seen))
    assert rc == 0

    conn = vintage.load(tmp_path)
    # internal codes, not WPU1175 / WPU1174
    assert dict(vintage.latest(conn, "ppi_switchgear"))["1992-01-01"] == 100.0
    assert dict(vintage.latest(conn, "ppi_transformer"))["1992-02-01"] == 100.5
    assert vintage.latest(conn, "WPU1175") == []
    assert vintage.latest(conn, "WPU1174") == []


def test_backfill_requests_deep_observation_start(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_leadlag_target_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert seen, "no HTTP calls made"
    assert all(p["observation_start"] == "1992-01-01" for p in seen)


def test_backfill_covers_all_four_target_series(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_leadlag_target_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert {p["series_id"] for p in seen} == {
        "WPU1175", "WPU1174", "PCU333415333415", "PCU333611333611"}


def test_backfill_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_leadlag_target_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    before = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    backfill_leadlag_target_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    after = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    assert before == after, "re-running the backfill must be a no-op"


# --- coverage validation -------------------------------------------------
# fred.fetch tolerates per-series failures by design: it collects errors and
# only raises when EVERY series failed. So 3 of 4 succeeding returns
# normally. That must not read as success here: these are existing Build
# index components, so a short backfill would silently leave a subset of the
# basket at its current 2007 depth while looking like it worked.

def test_backfill_fails_when_one_series_request_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_leadlag_target_history.main(
            ["--store", str(tmp_path)], http_get=make_get([], fail={"WPU1175"}))
    msg = str(e.value)
    assert "ppi_switchgear" in msg, msg
    assert "no rows" in msg, msg


def test_backfill_fails_when_one_series_returns_no_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_leadlag_target_history.main(
            ["--store", str(tmp_path)], http_get=make_get([], empty={"WPU1174"}))
    assert "ppi_transformer" in str(e.value)


def test_backfill_fails_when_every_row_is_a_dot(tmp_path, monkeypatch):
    """FRED marks unavailable observations "."; fred.fetch filters them, so a
    series can return HTTP 200 with rows and still yield nothing."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_leadlag_target_history.main(
            ["--store", str(tmp_path)],
            http_get=make_get([], dotted={"PCU333611333611"}))
    assert "ppi_genset" in str(e.value)
    assert not list((tmp_path / "obs").glob("*.jsonl"))


def test_backfill_fails_when_one_series_lacks_the_requested_depth(
        tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit) as e:
        backfill_leadlag_target_history.main(
            ["--store", str(tmp_path)],
            http_get=make_get([], shallow={"PCU333415333415"}))
    msg = str(e.value)
    assert "ppi_hvac_equip" in msg, msg
    assert "2007-01-01" in msg and "1992-01-01" in msg, msg


def test_backfill_writes_nothing_when_coverage_is_incomplete(
        tmp_path, monkeypatch):
    """Validation must run BEFORE the append -- a partial backfill in the
    store is worse than none, because the store is append-only."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    with pytest.raises(SystemExit):
        backfill_leadlag_target_history.main(
            ["--store", str(tmp_path)], http_get=make_get([], fail={"WPU1175"}))
    assert not list((tmp_path / "obs").glob("*.jsonl")), (
        "store was written despite incomplete coverage")


def test_backfill_honours_a_custom_observation_start(tmp_path, monkeypatch):
    """The depth requirement tracks --observation-start, not a hardcoded date:
    the SHALLOW fixture starts 2007-01, so asking for 2007-01 must pass."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    rc = backfill_leadlag_target_history.main(
        ["--store", str(tmp_path), "--observation-start", "2007-01-01"],
        http_get=make_get([], shallow={"PCU333415333415"}))
    assert rc == 0


def test_backfill_reports_per_series_coverage_on_success(
        tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_leadlag_target_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    out = capsys.readouterr().out
    for code in backfill_leadlag_target_history.SERIES_CODES:
        assert code in out, f"{code} missing from coverage report:\n{out}"
    assert out.count("1992-01-01") >= 1, out


def test_backfill_fails_when_series_missing_from_registry(tmp_path, monkeypatch):
    """The registry check is a real guard, not dead code."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    monkeypatch.setattr(backfill_leadlag_target_history, "SERIES_CODES",
                        ["ppi_switchgear", "not_a_real_series_code"])
    with pytest.raises(SystemExit) as e:
        backfill_leadlag_target_history.main(
            ["--store", str(tmp_path)], http_get=make_get([]))
    assert "not_a_real_series_code" in str(e.value)
