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
    # 4 existing + engine_ok + 5 gauge checks + fuel_sources_agree
    # + quilt_complete + grocery_items
    assert qa["total"] == 16
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
    eng = [c for c in qa_data["checks"] if c["name"] == "engine_ok"][0]
    assert eng["pass"] is False and "engine boom" in eng["detail"]
    assert not (out / "pulse.json").exists()


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
