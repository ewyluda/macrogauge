import csv
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

import jsonschema
import openpyxl
import pytest

from pipeline import run_daily
from pipeline.connectors.fred import today_et
from pipeline.store import vintage
from tests.test_fred import FakeResponse

FIXTURES = Path(__file__).parent / "fixtures"

# The symbols FMP actually serves (mirrors /stable/commodities-list). The fake
# answers only for requested∩known, like the real batch-quote route: a typo'd
# source_id in config/series.json quietly gets no quote, no store row — and the
# per-code store assertion in the e2e goes red instead of CI staying green.
FMP_QUOTES = {
    "GCUSD": 3412.5, "CLUSD": 71.85, "RBUSD": 2.11, "NGUSD": 3.45,
    "ZCUSX": 461.0, "KEUSX": 676.25, "ZSUSX": 1196.5, "ZLUSX": 68.98,
    "KCUSX": 334.25, "SBUSD": 223.43, "CCUSD": 8200.0, "LEUSX": 230.55,
}

# Equity quotes for the FMP_EQ /capacity batch: (price $, market cap $B).
FMP_EQUITY = {
    "CRWV": (72.91, 39.78), "ORCL": (192.64, 554.0), "NBIS": (170.0, 41.2),
    "APLD": (30.0, 8.1), "CORZ": (18.0, 6.7), "GLXY": (20.0, 7.4),
    "WULF": (22.0, 8.9), "HUT": (60.0, 11.1), "CIFR": (10.0, 7.3),
    "IREN": (55.0, 12.4), "KEEL": (4.0, 2.4), "RIOT": (23.0, 7.6),
    "BTDR": (14.0, 2.9), "WYFI": (25.0, 1.0), "BTBT": (3.0, 0.6),
    "MARA": (14.0, 4.6), "DOCN": (130.0, 12.2), "AKAM": (115.0, 17.3),
    "MSFT": (505.0, 3750.0), "AMZN": (230.0, 2400.0), "GOOGL": (185.0, 2250.0),
    "META": (720.0, 1820.0), "BABA": (110.0, 262.0), "TCEHY": (62.0, 570.0),
    "BIDU": (90.0, 31.0), "EQIX": (780.0, 76.0), "DLR": (160.0, 54.0),
    "NVDA": (170.0, 4150.0),
}


def _census_wb(sheet, rows):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(["Value of Private Construction Put in Place"])
    ws.append(["(Millions of dollars)"])
    ws.append([])
    ws.append(["Date", "Total", "Data center"])
    for r in rows:
        ws.append(list(r))
    ws.append(["The Census Bureau has reviewed this data product."])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_CENSUS_XLSX = {
    "privsatime.xlsx": _census_wb("Private SA", [
        ("Jun-26p", 1668966, 61000), ("Jun-25", 1500000, 45000), ("Jan-14", 900000, 1500)]),
    "privtime.xlsx": _census_wb("Private NSA", [
        ("Jun-26p", 144936, 5059), ("Jun-25", 130000, 3900), ("Jan-14", 75000, 124)]),
}


class _BytesResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


def _caiso_zip():
    """24 hourly LMP rows tagged with today's ET date — the collect.py _caiso
    wrapper passes no trade_date override, so the connector defaults its
    target trade date to today_et(); OPR_DT must match that for the e2e's
    fetch to find its rows (SPIKE-FINAL OPR_DT filter)."""
    day = today_et()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(("OPR_DT", "LMP_TYPE", "MW"))
    w.writerows((day, "LMP", 40.0) for _ in range(24))
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("prc_lmp.csv", buf.getvalue())
    return zbuf.getvalue()


_ICE_HEADER = ["Price hub", "Trade date", "Delivery start date", "Delivery \nend date",
              "High price $/MWh", "Low price $/MWh", "Wtd avg price $/MWh", "Change",
              "Daily volume MWh", "Number of trades", "Number of counterparties"]


def _ice_xlsx():
    """Two PJM WH Real Time Peak rows in the sheet keyed to the current year —
    ice.fetch defaults `year` from vintage_date (today_et()) since the
    collect.py _ice wrapper passes no year override."""
    year = today_et()[:4]
    d1, d2 = datetime(int(year), 1, 2), datetime(int(year), 1, 3)
    rows = [
        ["PJM WH Real Time Peak", d1, d1, d1, 75.0, 65.0, 70.11, 0.5, 12345, 42, 7],
        ["PJM WH Real Time Peak", d2, d2, d2, 77.0, 67.0, 72.38, 0.5, 12345, 42, 7],
    ]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = year
    ws.append(_ICE_HEADER)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


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
    if "oasis.caiso.com" in url:
        return _BytesResponse(_caiso_zip())
    if "docs.misoenergy.org" in url:
        return _text(FIXTURES / "miso_da_expost.csv")
    if "eia.gov/electricity/wholesale" in url:
        return _BytesResponse(_ice_xlsx())
    if "api.eia.gov" in url:
        if url.endswith("PET.EMD_EPD2D_PTE_NUS_DPG.W"):
            return FakeResponse({"response": {"total": 3, "data": [
                {"period": "2026-07-13", "value": 4.796},
                {"period": "2026-07-06", "value": 4.578},
                {"period": "2026-06-29", "value": 4.668}]}})
        name = "eia_weekly.json" if url.endswith(".W") else "eia_monthly.json"
        return FakeResponse(json.loads((FIXTURES / name).read_text()))
    if "financialmodelingprep.com" in url:
        requested = (params or {}).get("symbols", "").split(",")
        rows = []
        for s in requested:
            if s in FMP_QUOTES:
                rows.append({"symbol": s, "price": FMP_QUOTES[s],
                             "timestamp": 1783440000})
            elif s in FMP_EQUITY:
                px, cap_b = FMP_EQUITY[s]
                rows.append({"symbol": s, "price": px, "marketCap": cap_b * 1e9,
                             "timestamp": 1783440000})
        return FakeResponse(rows)
    if "clevelandfed.org" in url:
        return _TextResponse(
            "<h2>Inflation, month-over-month percent change</h2>"
            "<tr><td>July 2026</td><td>0.20</td><td>0.25</td>"
            "<td>0.18</td><td>0.22</td><td>07/10</td></tr>"
            "<tr><td>June 2026</td><td>0.15</td><td>0.24</td>"
            "<td>0.12</td><td>0.20</td><td>07/10</td></tr>"
            "<h2>Inflation, year-over-year percent change</h2>"
            "<tr><td>July 2026</td><td>3.71</td><td>2.81</td>"
            "<td>3.84</td><td>3.47</td><td>07/10</td></tr>")
    if "external-api.kalshi.com" in url:
        ticker = (params or {}).get("series_ticker", "")
        if ticker == "KXUSADATACENTERS":
            return FakeResponse({"markets": [
                {"floor_strike": 1000, "last_price_dollars": "0.9"},
                {"floor_strike": 2000, "last_price_dollars": "0.4"}]})
        if ticker == "KXDATACENTER":
            return FakeResponse({"markets": [{"last_price_dollars": "0.61"}]})
        # two rungs: a single priced rung is a degenerate ladder and raises
        return FakeResponse({"markets": [{"floor_strike": 0.1,
                                           "last_price_dollars": "0.9",
                                           "event_ticker": "KXCPI-26JUL",
                                           "close_time": "2026-08-11T00:00:00Z"},
                                          {"floor_strike": 0.3,
                                           "last_price_dollars": "0.5",
                                           "event_ticker": "KXCPI-26JUL",
                                           "close_time": "2026-08-11T00:00:00Z"}]})
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
        if "/state-gas-price-averages/" in url:
            return _text(FIXTURES / "aaa_states.html")
        return _text(FIXTURES / "aaa.html")
    if "mortgagenewsdaily.com" in url:
        return _text(FIXTURES / "mnd.html")
    if "coxautoinc.com/insights/feed" in url:
        return _text(FIXTURES / "manheim_feed.xml")
    if "coxautoinc.com/insights/manheim-used-vehicle-value-index" in url:
        return _text(FIXTURES / "manheim_post.html")
    if "data.bls.gov/cew" in url:
        return _text(FIXTURES / "qcew_industry23.csv")
    if "census.gov/construction" in url:
        return _BytesResponse(_CENSUS_XLSX[url.rsplit("/", 1)[1]])
    if "dramexchange.com" in url:
        return _text(FIXTURES / "dramex.html")
    if "console.vast.ai" in url:
        return FakeResponse(json.loads((FIXTURES / "vastai_bundles.json").read_text()))
    if "sfcompute.com" in url:
        return _text(FIXTURES / "sfcompute.html")
    if "openrouter.ai" in url:
        return FakeResponse(json.loads((FIXTURES / "openrouter_models.json").read_text()))
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


def test_run_phase_isolation_contract():
    """The shared runner every publish phase goes through: success returns
    (value, None); failure returns (None, 'Type: msg') and never propagates;
    jsonschema.ValidationError re-raises — invalid JSON must never deploy."""
    assert run_daily._run_phase("demo", lambda: 42) == (42, None)

    def boom():
        raise RuntimeError("kaput")
    assert run_daily._run_phase("demo", boom) == (None, "RuntimeError: kaput")

    def invalid():
        raise jsonschema.ValidationError("bad artifact")
    with pytest.raises(jsonschema.ValidationError):
        run_daily._run_phase("demo", invalid)


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
                 "accountability_nfp.json", "fuel.json", "outlook.json", "heatcheck.json",
                 "stress.json", "recession.json", "datacenter.json",
                 "metros.json", "geo.json", "matrix.json", "labor.json",
                 "commodities.json", "capacity.json"):
        assert (out / name).exists(), name
    status = json.loads((out / "sources_status.json").read_text())
    assert len(status["sources"]) == 30
    assert all(s["ok"] for s in status["sources"])
    kalshi_dc_row = [s for s in status["sources"] if s["name"] == "KALSHI_DC"][0]
    assert kalshi_dc_row["ok"] is True
    qa = json.loads((out / "qa.json").read_text())
    # 4 existing + engine_ok + nowcast_ok + outlook_ok + composites_ok + single_run_stamp
    # + 5 gauge checks + fuel_sources_agree + quilt_complete + grocery_items + datacenter_ok
    # + geography_ok + labor_ok + commodities_ok + capacity_ok
    assert qa["total"] == 24
    stamp = [c for c in qa["checks"] if c["name"] == "single_run_stamp"][0]
    assert stamp["pass"] is True  # a clean full run leaves no stale artifacts
    official = json.loads((out / "official.json").read_text())
    assert len(official["components"]) == 14
    assert len(official["quotes"]) == 13
    # every registered FMP series must land a store row — this is what catches
    # a typo'd source_id (the ZCUSD-vs-ZCUSX class) that the real API would
    # silently drop from the batch-quote response
    conn = vintage.load(store)
    for code in ("fmp_gold", "fmp_wti", "fmp_rbob", "fmp_natgas", "fmp_corn",
                 "fmp_wheat", "fmp_soybeans", "fmp_soybean_oil", "fmp_coffee",
                 "fmp_sugar", "fmp_cocoa", "fmp_live_cattle"):
        assert vintage.latest(conn, code), f"no store rows for {code}"
    # FMP_EQ equity batch: cap lands in $B under the remapped internal codes.
    assert vintage.latest(conn, "fmp_cap_msft")[-1][1] == pytest.approx(3750.0)
    assert vintage.latest(conn, "fmp_px_crwv")[-1][1] == pytest.approx(72.91)
    assert vintage.latest(conn, "fmp_cap_nvda")[-1][1] == pytest.approx(4150.0)
    # P2 T3: the zillow fixtures carry one registered metro (New York,
    # 394913) — its rows landing under the internal codes pins the whole
    # subset-aware path (collect passes source_ids through, id_map remaps
    # "zori:394913" -> "zori_394913"); the unregistered Rochester msa row
    # (395031) must be dropped, and the US codes must survive the remap.
    assert vintage.latest(conn, "zori_394913")[-1][1] == pytest.approx(3300.2)
    assert vintage.latest(conn, "zhvi_394913")[-1][1] == pytest.approx(660000.0)
    assert vintage.latest(conn, "zori_us")[-1][1] == pytest.approx(2105.7)
    assert not vintage.latest(conn, "zori_395031")
    # P2 T4: the state-averages fixture rides the /state-gas-price-averages/
    # branch of the AAA fake — a TX row landing under the internal code pins
    # the id_map remap ("tx" -> "aaa_gas_tx") through the real collect path.
    assert vintage.latest(conn, "aaa_gas_tx")[-1][1] == pytest.approx(3.568)
    assert vintage.latest(conn, "aaa_gas_dc")[-1][1] == pytest.approx(4.069)
    # P2 T5: EIA_STATE_RES rides the generic seriesid branch of the EIA fake
    # (any *.M url -> eia_monthly.json) — a TX row landing under the internal
    # code pins the id_map remap ("ELEC.PRICE.TX-RES.M" -> "eia_elec_res_tx").
    assert vintage.latest(conn, "eia_elec_res_tx")[-1][1] == pytest.approx(17.45)
    # Value-pin the DC-context series, not just presence — a ticker-branch
    # regression in the Kalshi fake (falling back to the generic KXCPI
    # single-market payload) would still produce a store row with ok:True,
    # just the wrong value (1.0, the CPI-fixture binary read), so presence
    # alone can't catch it.
    assert vintage.latest(conn, "kalshi_dc_count")[-1][1] == pytest.approx(1800.0)
    assert vintage.latest(conn, "kalshi_dc_nuclear")[-1][1] == pytest.approx(0.61)
    # SPIKE-FINAL latest weekly value (2026-07-13), served by the diesel
    # seriesid branch in the EIA fake above.
    assert vintage.latest(conn, "eia_diesel")[-1][1] == pytest.approx(4.796)
    # cpi_water rides the FRED fake generically (fred_cpiaucns.json fixture);
    # its latest row is the fixture's 2026-04-01 print.
    assert vintage.latest(conn, "cpi_water")[-1][1] == pytest.approx(320.1)
    checks = {c["name"]: c for c in qa["checks"]}
    assert checks["outlook_ok"]["pass"] is True
    dc = json.loads((out / "datacenter.json").read_text())
    assert dc["context"] is not None
    assert dc["context"]["kalshi"]["dc_count_expected"] == pytest.approx(1800.0)
    assert dc["context"]["diesel"] is not None
    assert dc["context"]["colo"]["source"]           # hand-seed provenance present
    assert all("stale" in c for c in dc["indexes"]["build"]["components"])
    assert dc["indexes"]["build"]["groups"]
    capacity = json.loads((out / "capacity.json").read_text())
    assert len(capacity["companies"]) == 29
    crwv = next(c for c in capacity["companies"] if c["t"] == "CRWV")
    # fake FMP_EQ cap (39.78) + config nd flows through to EV
    assert crwv["cap"] == pytest.approx(39.78)
    assert crwv["ev"] == pytest.approx(39.78 + crwv["nd"])
    orcl = next(c for c in capacity["companies"] if c["t"] == "ORCL")
    assert orcl["role"] == "hyperscaler" and orcl["ev_per_mw"] is None
    assert checks["capacity_ok"]["pass"] is True
    # P2 T9: the geography phase publishes metros/geo/matrix from the same store
    # rows pinned above. rc==0 already proves each validated inline; here we pin
    # that real values flow end-to-end and every artifact shares the run stamp.
    assert checks["geography_ok"]["pass"] is True
    run_stamp = pulse["published_at"]
    metros_out = json.loads((out / "metros.json").read_text())
    assert metros_out["published_at"] == run_stamp
    ny = next(m for m in metros_out["metros"] if m["region_id"] == "394913")
    assert ny["zori"]["value"] == pytest.approx(3300.2)   # from zori_394913
    geo_out = json.loads((out / "geo.json").read_text())
    assert geo_out["published_at"] == run_stamp
    tx = next(s for s in geo_out["states"] if s["state"] == "TX")
    assert tx["gas_regular"]["value"] == pytest.approx(3.568)      # aaa_gas_tx
    assert tx["elec_res_cents"]["value"] == pytest.approx(17.45)   # eia_elec_res_tx
    assert checks["labor_ok"]["pass"] is True
    labor_out = json.loads((out / "labor.json").read_text())
    assert labor_out["published_at"] == run_stamp
    # PAYEMS rides the FRED fake (fred_cpiaucns.json for any series_id); its
    # latest fixture obs is 2026-04-01 = 320.1 -> level_k rounds to 320.
    assert labor_out["payrolls"]["level_k"] == 320
    matrix_out = json.loads((out / "matrix.json").read_text())
    assert matrix_out["published_at"] == run_stamp
    med = next(r for g in matrix_out["groups"] for r in g["rows"]
               if r["code"] == "MEDCPIM158SFRBCLE")
    assert med["value"] == pytest.approx(320.1)  # FRED fixture latest 2026-04-01


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


def test_geography_failure_does_not_block_gauge_or_datacenter(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("geo boom")

    monkeypatch.setattr(run_daily.geo_json, "build", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "pulse.json").exists()       # core gauge block unaffected
    assert (out / "datacenter.json").exists()  # DC block unaffected
    assert (out / "metros.json").exists()      # metros wrote before geo raised
    assert not (out / "geo.json").exists()     # geo never wrote
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    assert checks["geography_ok"]["pass"] is False
    assert "geo boom" in checks["geography_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert checks["datacenter_ok"]["pass"] is True


def test_geography_schema_violation_fails_run(tmp_path, monkeypatch):
    # A schema-invalid geography artifact must fail the whole run (never deploy),
    # like every other phase's ValidationError.
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.metros_json, "build",
                        lambda conn: {"metros": "not-an-array", "national": {}})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)


def test_labor_failure_does_not_block_gauge_or_geography(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("labor boom")

    monkeypatch.setattr(run_daily.labor_json, "build", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "pulse.json").exists()
    assert (out / "geo.json").exists()
    assert not (out / "labor.json").exists()
    checks = {c["name"]: c for c in json.loads((out / "qa.json").read_text())["checks"]}
    assert checks["labor_ok"]["pass"] is False
    assert "labor boom" in checks["labor_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True


def test_labor_schema_violation_fails_run(tmp_path, monkeypatch):
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.labor_json, "build",
                        lambda conn: {"payrolls": "nope"})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)


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
    assert "nowcast_params_published" not in checks


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


def test_outlook_failure_does_not_block_composites_or_qa(tmp_path, monkeypatch):
    # The outlook block mirrors the nowcast/composites isolation contract:
    # its failure surfaces in outlook_ok and must never take down the gauge,
    # the nowcast, the composites, or qa publication.
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("outlook boom")

    monkeypatch.setattr(run_daily.outlook_engine, "run", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "pulse.json").exists()           # core gauge block unaffected
    assert (out / "nowcast_latest.json").exists()  # phase-3 block unaffected
    assert (out / "heatcheck.json").exists()       # composites block unaffected
    assert not (out / "outlook.json").exists()     # outlook block never wrote
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    assert checks["outlook_ok"]["pass"] is False
    assert "outlook boom" in checks["outlook_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert checks["nowcast_ok"]["pass"] is True
    assert checks["composites_ok"]["pass"] is True


def test_outlook_schema_violation_fails_run(tmp_path, monkeypatch):
    # The outlook block's ValidationError re-raise: a contract-violating
    # outlook.json must crash the run (never deploy), not be swallowed into
    # the outlook_ok degradation path.
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.outlook_engine, "run",
                        lambda *a, **k: {"bogus": True})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
    assert not (out / "qa.json").exists()  # run died before qa


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


def test_datacenter_failure_does_not_block_other_blocks(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("dc boom")

    monkeypatch.setattr(run_daily.dcindex, "run", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert not (out / "datacenter.json").exists()
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    assert checks["datacenter_ok"]["pass"] is False and "dc boom" in checks["datacenter_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert (out / "heatcheck.json").exists() and (out / "pulse.json").exists()


def test_datacenter_schema_violation_fails_run(tmp_path, monkeypatch):
    # The datacenter block's ValidationError re-raise must stay ahead of its
    # generic except (same contract the phase-3 test pins above): a
    # schema-invalid datacenter.json must crash the run, never deploy.
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.datacenter_json, "build",
                        lambda *a, **k: {"bogus": True})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
    assert not (out / "qa.json").exists()  # run died before qa


def test_commodities_failure_does_not_block_gauge_or_labor(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("commodities boom")

    monkeypatch.setattr(run_daily.commodities_json, "build", boom)
    out = tmp_path / "out"
    rc = run_daily.main(["--store", str(tmp_path / "store"), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    qa = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa["checks"]}
    assert checks["commodities_ok"]["pass"] is False
    assert "commodities boom" in checks["commodities_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert checks["labor_ok"]["pass"] is True
    assert not (out / "commodities.json").exists()


def test_capacity_failure_does_not_block_publish(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("capacity boom")

    monkeypatch.setattr(run_daily.capacity_json, "build", boom)
    out = tmp_path / "out"
    rc = run_daily.main(["--store", str(tmp_path / "store"), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "sources_status.json").exists()
    qa = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa["checks"]}
    assert checks["capacity_ok"]["pass"] is False
    assert "capacity boom" in checks["capacity_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert checks["commodities_ok"]["pass"] is True
    assert not (out / "capacity.json").exists()


def test_capacity_schema_violation_fails_run(tmp_path, monkeypatch):
    # The capacity block's ValidationError re-raise must stay ahead of its
    # generic except (same contract every other isolated phase pins): a
    # schema-invalid capacity.json must crash the run, never deploy.
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.capacity_json, "build",
                        lambda *a, **k: {"bogus": True})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
    assert not (out / "qa.json").exists()  # run died before qa
