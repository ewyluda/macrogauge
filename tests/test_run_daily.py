import json
from pathlib import Path

import jsonschema
import pytest

from pipeline import run_daily
from tests.test_fred import FakeResponse

FIXTURES = Path(__file__).parent / "fixtures"


def fake_get(url, params=None, timeout=None, **kw):
    if "api.stlouisfed.org" in url:
        # test_fred.fake_get hard-asserts series_id == "CPIAUCNS" (written when
        # FRED had a single registry series); the registry now carries 17 FRED
        # series, so the FRED connector's per-series loop calls this with 17
        # different ids. Use a laxer local fake (same fixture/data) instead of
        # reusing that strict one — same pattern test_bls's laxer fake_post uses.
        assert params["api_key"] == "test-key"
        assert params["file_type"] == "json"
        return FakeResponse(json.loads((FIXTURES / "fred_cpiaucns.json").read_text()))
    if "api.eia.gov" in url:
        name = "eia_weekly.json" if ".W" in url else "eia_monthly.json"
        return FakeResponse(json.loads((FIXTURES / name).read_text()))
    if "financialmodelingprep.com" in url:
        if "economic-calendar" in url:
            return FakeResponse([{"event": "Consumer Price Index MoM",
                                  "date": "2026-07-14 08:30:00", "estimate": 0.3}])
        return FakeResponse(json.loads((FIXTURES / "fmp_quote.json").read_text()))
    if "clevelandfed.org" in url:
        return _TextResponse("<tr><td>July 2026</td><td>0.20</td><td>0.25</td>"
                             "<td>0.18</td><td>0.22</td><td>07/10</td></tr>")
    if "external-api.kalshi.com" in url:
        return FakeResponse({"markets": [{"floor_strike": 0.2,
                                           "last_price_dollars": "1.0"}]})
    if "fiscaldata.treasury.gov" in url:
        return FakeResponse(json.loads((FIXTURES / "treasury_debt.json").read_text()))
    if "zillowstatic.com" in url:
        name = "zillow_zori.csv" if "zori" in url else "zillow_zhvi.csv"
        return _text(FIXTURES / name)
    if "freddiemac.com" in url:
        return _text(FIXTURES / "pmms.csv")
    if "ctfassets.net" in url:
        return _text(FIXTURES / "aptlist.csv")
    if "marsapi.ams.usda.gov" in url:
        assert kw.get("auth") == ("test-key", "")
        return FakeResponse(json.loads((FIXTURES / "usda_report.json").read_text()))
    if "gasprices.aaa.com" in url:
        return _text(FIXTURES / "aaa.html")
    if "mortgagenewsdaily.com" in url:
        return _text(FIXTURES / "mnd.html")
    if "manheim.com" in url:
        return _text(FIXTURES / "manheim.html")
    raise AssertionError(f"unexpected url {url}")


class _TextResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _text(path):
    return _TextResponse(path.read_text())


def fake_post(url, json=None, timeout=None):
    class R:
        def raise_for_status(self):
            pass

        def json(self):
            import json as j
            return j.loads((FIXTURES / "bls_ap_full.json").read_text())
    return R()


def set_keys(monkeypatch):
    for k in ("FRED_API_KEY", "EIA_API_KEY", "BLS_API_KEY", "FMP_API_KEY", "USDA_API_KEY"):
        monkeypatch.setenv(k, "test-key")


def test_end_to_end_all_sources(tmp_path, monkeypatch):
    set_keys(monkeypatch)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    pulse = json.loads((out / "pulse.json").read_text())
    assert pulse["official"]["month"] == "2026-04-01"
    assert isinstance(pulse["gauge"]["yoy_pct"], float)
    assert isinstance(pulse["gap_pp"], float)
    for name in ("gauge_daily.json", "compare.json", "gaptable.json", "replay.json",
                 "quilt_months_24.json", "quilt_months_48.json", "quilt_months_all.json",
                 "methodology.json", "grocery_basket.json", "real_wages.json",
                 "nowcast_latest.json", "nextprint.json", "releases.json", "backtest.json",
                 "accountability_cpi.json", "accountability_pce.json",
                 "accountability_nfp.json", "fuel.json", "heatcheck.json",
                 "stress.json", "recession.json"):
        assert (out / name).exists(), name
    status = json.loads((out / "sources_status.json").read_text())
    assert len(status["sources"]) == 15
    assert all(s["ok"] for s in status["sources"])
    qa = json.loads((out / "qa.json").read_text())
    # 4 existing + engine_ok + nowcast_ok + composites_ok + single_run_stamp
    # + 5 gauge checks + fuel_sources_agree + quilt_complete + grocery_items
    assert qa["total"] == 19
    stamp = [c for c in qa["checks"] if c["name"] == "single_run_stamp"][0]
    assert stamp["pass"] is True  # a clean full run leaves no stale artifacts
    official = json.loads((out / "official.json").read_text())
    assert len(official["components"]) == 14
    assert len(official["quotes"]) == 13


def test_engine_failure_still_publishes_status_and_qa(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("engine boom")

    monkeypatch.setattr(run_daily.gauge_engine, "run", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0  # publication never blocks; failure surfaces in qa
    assert (out / "sources_status.json").exists()
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    eng = checks["engine_ok"]
    assert eng["pass"] is False and "engine boom" in eng["detail"]
    assert not (out / "pulse.json").exists()
    # composites don't depend on the gauge engine — they still publish
    assert (out / "heatcheck.json").exists()
    assert checks["composites_ok"]["pass"] is True
    # the nowcast DOES depend on the gauge; it skips with the upstream cause
    # named, not a cryptic TypeError from feeding it gauge_result=None
    assert checks["nowcast_ok"]["pass"] is False
    assert "gauge engine failed upstream" in checks["nowcast_ok"]["detail"]


def test_basket_config_failure_still_publishes_status_and_qa(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def bad_basket(*args, **kwargs):
        raise ValueError("weights sum to 0.9")

    monkeypatch.setattr(run_daily.basket_mod, "load_basket", bad_basket)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0  # config failure surfaces in qa, never blocks
    qa_data = json.loads((out / "qa.json").read_text())
    eng = [c for c in qa_data["checks"] if c["name"] == "engine_ok"][0]
    assert eng["pass"] is False and "weights sum" in eng["detail"]


def test_one_source_down_still_publishes(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def get_with_eia_down(url, params=None, timeout=None, **kw):
        if "api.eia.gov" in url:
            raise RuntimeError("EIA 503")
        return fake_get(url, params=params, timeout=timeout, **kw)

    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=get_with_eia_down, http_post=fake_post)
    assert rc == 0  # publication never blocks
    status = json.loads((out / "sources_status.json").read_text())
    eia_row = [s for s in status["sources"] if s["name"] == "EIA"][0]
    assert eia_row["ok"] is False


def test_missing_fred_key_clean_exit(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "")  # Actions passes unset secrets as ""
    with pytest.raises(SystemExit, match="FRED_API_KEY"):
        run_daily.main(["--store", str(tmp_path / "s"), "--out", str(tmp_path / "o")])


def test_schema_invalid_payload_fails_the_run(tmp_path, monkeypatch):
    # a writer producing contract-violating output must CRASH the run
    # (nothing deployable), not be swallowed as an "engine failure"
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.pulse, "build", lambda *a, **k: {"bogus": True})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
    assert (out / "sources_status.json").exists()  # published before the strict block
    assert not (out / "qa.json").exists()          # run died before qa


def test_validation_error_inside_engine_block_not_swallowed(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def raise_validation(*args, **kwargs):
        raise jsonschema.ValidationError("contract violated")

    monkeypatch.setattr(run_daily.gauge_engine, "run", raise_validation)
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)


def test_zero_eia_value_zero_guard_never_blocks_publication(tmp_path, monkeypatch):
    # Zero eia_last would crash fuel_div computation (outside engine try).
    # Verify zero-guard prevents crash and run completes with qa published.
    set_keys(monkeypatch)

    def get_with_zero_eia(url, params=None, timeout=None, **kw):
        if "api.eia.gov" in url:
            # Return fixture with the most recent value zeroed
            fixture_data = json.loads((FIXTURES / "eia_weekly.json").read_text())
            # Zero out the first (most recent) observation in response.data
            response_data = fixture_data.get("response", {}).get("data", [])
            if response_data:
                response_data[0]["value"] = 0.0
            return FakeResponse(fixture_data)
        return fake_get(url, params=params, timeout=timeout, **kw)

    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=get_with_zero_eia, http_post=fake_post)
    assert rc == 0  # run completes (zero-guard prevents crash)
    qa_data = json.loads((out / "qa.json").read_text())
    # With eia_last = 0.0 (falsy), fuel_div stays None, so no fuel_sources_agree check
    fuel_check = next((c for c in qa_data["checks"]
                       if c["name"] == "fuel_sources_agree"), None)
    # fuel_check should be None because fuel_div was None (zero-guard prevented creation)
    assert fuel_check is None


def test_nowcast_failure_does_not_block_gauge_or_composites(tmp_path, monkeypatch):
    # Risk 1 (docs/plans/2026-07-11-phase-3-4-structural-risks.md): a phase-3
    # exception must not take composites or the gauge's critical QA down with it.
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("nowcast boom")

    monkeypatch.setattr(run_daily, "build_nowcast", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "pulse.json").exists()  # core gauge block unaffected
    assert (out / "heatcheck.json").exists()  # composites block unaffected
    assert not (out / "nowcast_latest.json").exists()  # phase-3 block never wrote
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    assert checks["nowcast_ok"]["pass"] is False
    assert "nowcast boom" in checks["nowcast_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert checks["composites_ok"]["pass"] is True
    # critical gauge checks survive a phase-3 failure — this was the bug
    assert checks["gauge_current"]["pass"] is True
    assert checks["gauge_components_present"]["pass"] is True
    assert checks["basket_weights_sum"]["pass"] is True


def test_composites_failure_does_not_block_gauge_or_nowcast(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("heatcheck boom")

    monkeypatch.setattr(run_daily.composite_json, "write_all", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "pulse.json").exists()  # core gauge block unaffected
    assert (out / "nowcast_latest.json").exists()  # phase-3 block unaffected
    assert not (out / "heatcheck.json").exists()  # composites block never wrote
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    assert checks["composites_ok"]["pass"] is False
    assert "heatcheck boom" in checks["composites_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert checks["nowcast_ok"]["pass"] is True


def test_release_calendar_exhausted_degrades_nowcast_instead_of_crashing(tmp_path, monkeypatch):
    # config/release_calendar.json's last entry is 2026-12-10 — every run from
    # 2026-12-11 onward hits next_print()=None until the yearly calendar refresh.
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.release_calendar, "next_print", lambda *a, **k: None)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "pulse.json").exists()
    assert (out / "heatcheck.json").exists()
    nowcast = json.loads((out / "nowcast_latest.json").read_text())
    assert nowcast["release_date"] is None
    assert nowcast["reference_month"] is None
    assert nowcast["cpi"]["status"] == "unavailable"
    nextprint = json.loads((out / "nextprint.json").read_text())
    assert nextprint["release_date"] is None
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    assert checks["nowcast_ok"]["pass"] is True  # exhaustion is not an error
    assert checks["engine_ok"]["pass"] is True
    assert checks["nowcast_params_published"]["pass"] is True


def test_stale_leftover_artifact_flagged_by_single_run_stamp(tmp_path, monkeypatch):
    # Risk 3: a partial/manual run can leave artifacts in the out dir that this
    # run doesn't rewrite; they'd be committed and deployed alongside today's
    # files. The single_run_stamp check makes that mixed set visible in qa.json.
    set_keys(monkeypatch)
    store, out = tmp_path / "store", tmp_path / "out"
    out.mkdir(parents=True)
    (out / "leftover.json").write_text(json.dumps(
        {"published_at": "2026-07-01T01:00:00Z", "orphan": True}))
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    qa_data = json.loads((out / "qa.json").read_text())
    stamp = [c for c in qa_data["checks"] if c["name"] == "single_run_stamp"][0]
    assert stamp["pass"] is False
    assert "leftover.json" in stamp["detail"]


def test_phase3_writer_validates_inline_and_validation_error_fails_run(tmp_path, monkeypatch):
    # Risk 3: validation now happens inside the writer, right after each file
    # lands — a schema-invalid phase-3 artifact must crash the run (never
    # deploy), not be swallowed by the nowcast block's generic except.
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.phase3, "build_nextprint",
                        lambda nowcast: {"bogus": True})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
    assert not (out / "qa.json").exists()  # run died before qa
