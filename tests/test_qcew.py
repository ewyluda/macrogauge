from pathlib import Path

import pytest

from pipeline.connectors import qcew

FIXTURE = Path(__file__).parent / "fixtures" / "qcew_industry23.csv"


class _Resp:
    def __init__(self, text, status=200):
        self.text, self._status = text, status

    def raise_for_status(self):
        if self._status != 200:
            raise RuntimeError(f"HTTP {self._status}")


def fake_get(url, timeout=None, **kw):
    assert "data.bls.gov/cew/data/api/" in url and url.endswith("/industry/23.csv")
    return _Resp(FIXTURE.read_text())


def test_fetch_filters_to_registered_areas_private_ownership():
    obs = qcew.fetch(["US000", "06000"], vintage_date="2026-07-12", http_get=fake_get)
    assert obs, "no observations parsed"
    assert {o.series_code for o in obs} == {"US000", "06000"}
    for o in obs:
        assert o.source == "QCEW" and o.route == "CSV"
        assert o.obs_date.endswith("-01")
        assert o.obs_date[5:7] in ("01", "04", "07", "10")
        assert o.value > 0


def test_disclosure_suppressed_rows_excluded_not_zero():
    # AK (02000) is disclosure_code "N" with avg_wkly_wage 0 in the fixture —
    # a genuinely suppressed BLS row, not a real zero wage. Ingesting it as
    # 0.0 would make AK look ~100% cheaper than national in state parity.
    obs = qcew.fetch(["US000", "02000"], vintage_date="2026-07-12", http_get=fake_get)
    assert {o.series_code for o in obs} == {"US000"}


def test_recent_quarters_walks_back_across_year_boundary():
    assert qcew._recent_quarters("2026-01-15", n=3) == [(2025, 3), (2025, 4), (2026, 1)]


def test_malformed_quarter_body_tolerated_but_all_malformed_raises():
    # A 200 response that isn't the expected CSV (e.g. an HTML maintenance
    # page) must fail that quarter only — never discard the other quarters.
    calls = []

    def wobbly_get(url, timeout=None, **kw):
        calls.append(url)
        if len(calls) == 1:
            return _Resp("<html><body>scheduled maintenance</body></html>")
        return _Resp(FIXTURE.read_text())

    obs = qcew.fetch(["US000"], vintage_date="2026-07-12", http_get=wobbly_get)
    assert obs  # the other quarters still parsed
    assert len(calls) == qcew.N_QUARTERS

    def all_html_get(url, timeout=None, **kw):
        return _Resp("<html>oops</html>")

    with pytest.raises(RuntimeError, match="no quarter loaded"):
        qcew.fetch(["US000"], vintage_date="2026-07-12", http_get=all_html_get)


def test_suppressed_row_with_blank_wage_field_skipped():
    # BLS format wobble: a suppressed cell arrives blank instead of 0 — the
    # disclosure_code check must run before float() so the row is skipped,
    # not a ValueError that discards the quarter.
    lines = FIXTURE.read_text().splitlines()
    ak = lines[1].split(",")
    assert ak[0] == '"02000"' and ak[7] == '"N"'
    ak[15] = ""  # avg_wkly_wage
    csv_text = "\n".join([lines[0], ",".join(ak), lines[5]]) + "\n"

    obs = qcew.fetch(["US000", "02000"], vintage_date="2026-07-12",
                     http_get=lambda url, timeout=None, **kw: _Resp(csv_text))
    assert {o.series_code for o in obs} == {"US000"}


def test_missing_quarters_tolerated_but_all_missing_raises():
    calls = []

    def flaky_get(url, timeout=None, **kw):
        calls.append(url)
        if len(calls) <= 2:          # the two newest-walked quarters 404
            return _Resp("", status=404)
        return _Resp(FIXTURE.read_text())

    obs = qcew.fetch(["US000"], vintage_date="2026-07-12", http_get=flaky_get)
    assert obs  # later quarters still loaded

    def dead_get(url, timeout=None, **kw):
        return _Resp("", status=404)

    with pytest.raises(RuntimeError, match="no quarter loaded"):
        qcew.fetch(["US000"], vintage_date="2026-07-12", http_get=dead_get)


def test_fetch_partial_quarter_failure_emits_warning():
    from pipeline.connectors.util import PartialFetchWarning
    calls = []

    def wobbly_get(url, timeout=None, **kw):
        calls.append(url)
        if len(calls) == 1:
            return _Resp("<html><body>scheduled maintenance</body></html>")
        return _Resp(FIXTURE.read_text())

    with pytest.warns(PartialFetchWarning):
        qcew.fetch(["US000"], vintage_date="2026-07-12", http_get=wobbly_get)


def _http_resp(status):
    import requests

    class R(_Resp):
        def raise_for_status(self):
            if self._status != 200:
                resp = requests.Response()
                resp.status_code = self._status
                raise requests.HTTPError(f"{self._status} Client Error", response=resp)
    return R("", status=status)


def _quarter(url):
    return tuple(int(p) for p in url.split("/industry/")[0].split("/")[-2:])


def test_unpublished_newest_quarters_404_silently(recwarn):
    # On 2026-10-02 the window ends at 2026q4; BLS has published through
    # 2026q1, so q2-q4 404. That is the lag, not a failure — no warning.
    def get(url, timeout=None, **kw):
        return _http_resp(404) if _quarter(url) > (2026, 1) else _Resp(FIXTURE.read_text())

    from pipeline.connectors.util import PartialFetchWarning
    qcew.fetch(["US000"], vintage_date="2026-10-02", http_get=get)
    assert not [w for w in recwarn if issubclass(w.category, PartialFetchWarning)]


def test_404_behind_a_loaded_quarter_and_5xx_ahead_still_warn():
    from pipeline.connectors.util import PartialFetchWarning

    def get(url, timeout=None, **kw):
        q = _quarter(url)
        if q == (2025, 3):
            return _http_resp(404)       # a hole behind 2026q1: real gap
        if q == (2026, 2):
            return _http_resp(503)       # outage, not "not yet published"
        if q > (2026, 1):
            return _http_resp(404)
        return _Resp(FIXTURE.read_text())

    with pytest.warns(PartialFetchWarning) as rec:
        qcew.fetch(["US000"], vintage_date="2026-10-02", http_get=get)
    msg = str(rec[0].message)
    assert "2025q3" in msg and "2026q2" in msg
    assert "2026q3" not in msg and "2026q4" not in msg


def test_window_reaches_the_year_ago_base_of_the_newest_published_quarter():
    # QCEW publishes ~3 quarters behind (the ~5-month lag), so on 2026-07-25
    # the newest published quarter is 2025q4 (q0-3). A window that stops
    # short of a series' year-ago base can never compute a wage YoY — which
    # is exactly why geo.json shipped yoy_pct: null for all 51 states before
    # N_QUARTERS first widened to cover 2024q4.
    #
    # But a series' "as_of" is its OWN latest observation, not the newest
    # quarter BLS published for anyone — a disclosure-suppressed latest
    # quarter pushes a series' own as_of (and therefore its year-ago base)
    # deeper into the window. This asserts all three tolerance levels the
    # N=8+k rule (see qcew.py) is sized for:
    #   k=0 (2024q4): the normal case, zero suppression.
    #   k=1 (2024q3): Louisiana's single-quarter flicker (latest=2025q3).
    #   k=2 (2024q2): qcew_wage23_c41067's two-consecutive-quarter
    #     suppression (latest=2025q1) — the case already live on this branch.
    window = qcew._recent_quarters("2026-07-25")
    assert (2025, 4) in window, "newest published quarter missing"
    assert (2024, 4) in window, "year-ago base missing — YoY impossible (k=0)"
    assert (2024, 3) in window, "one-quarter-suppression base missing (k=1)"
    assert (2024, 2) in window, "two-quarter-suppression base missing (k=2)"


def test_multiquarter_suppression_still_resolves_a_year_ago_base():
    # Regression for the N_QUARTERS widening: build a synthetic series
    # disclosure-suppressed in the two NEWEST quarters (k=2, mirroring
    # qcew_wage23_c41067) and confirm fetch() actually returns both the
    # series' own latest observation AND its year-ago base — the two
    # observations geo.py/dc_markets.py need to compute a YoY at all.
    #
    # This must FAIL against N_QUARTERS == 8 (confirmed by temporarily
    # reverting the constant to 8 and re-running: the base observation
    # disappears because the fetch window never requests that quarter) and
    # PASS at N_QUARTERS == 10.
    AREA = "99999"
    SUPPRESSED = {(2025, 3), (2025, 4)}   # this series' two newest quarters
    NOT_YET_PUBLISHED = {(2026, 1), (2026, 2), (2026, 3)}  # real BLS 404s

    HEADER = ("area_fips,own_code,industry_code,agglvl_code,size_code,year,"
             "qtr,disclosure_code,qtrly_estabs,month1_emplvl,month2_emplvl,"
             "month3_emplvl,total_qtrly_wages,taxable_qtrly_wages,"
             "qtrly_contributions,avg_wkly_wage")

    def fake_get(url, timeout=None, **kw):
        year, qtr = (int(p) for p in url.split("/industry/")[0].split("/")[-2:])
        if (year, qtr) in NOT_YET_PUBLISHED:
            return _Resp("", status=404)
        suppressed = (year, qtr) in SUPPRESSED
        disclosure_code = "N" if suppressed else ""
        avg_wage = "0" if suppressed else "1500"
        row = (f'"{AREA}","5","23","74","0",{year},{qtr},"{disclosure_code}",'
              f'100,900,900,900,1000000,100000,10000,{avg_wage}')
        return _Resp(HEADER + "\n" + row + "\n")

    obs = qcew.fetch([AREA], vintage_date="2026-07-25", http_get=fake_get)
    by_date = {o.obs_date: o.value for o in obs}

    # this series' own latest obs is 2025q2 (2025-04-01): 2025q3/q4 are
    # suppressed, and 2026q1-q3 haven't published yet.
    assert "2025-04-01" in by_date, "series' own latest observation missing"
    # its year-ago base is 2024q2 (2024-04-01) — q0-9 in the N=8+k rule
    # (k=2). Absent this, geo.py's yoy_pct (obs[as_of]/obs[base] - 1) has no
    # base to divide by and silently returns None.
    assert "2024-04-01" in by_date, (
        "year-ago base of the series' own latest obs is missing from the "
        "fetch window — this is the actual defect: YoY is uncomputable")


def test_emits_employment_as_its_own_series():
    # month3_emplvl rides in the same rows we already download. It becomes a
    # separate series code so store rows stay append-only and
    # schema-versionless — no Observation field is added.
    obs = qcew.fetch(["51107", "51107~emp"], vintage_date="2026-07-12",
                     http_get=fake_get)
    by_code = {o.series_code: o for o in obs}
    assert set(by_code) == {"51107", "51107~emp"}
    assert by_code["51107"].value == 2264.0        # avg_wkly_wage
    assert by_code["51107~emp"].value == 26151.0   # month3_emplvl
    assert by_code["51107~emp"].obs_date == "2025-10-01"
    assert by_code["51107~emp"].source == "QCEW"
    assert by_code["51107~emp"].route == "CSV"


def test_county_fips_flow_through_unchanged():
    # The industry endpoint returns every area in one file; area is a
    # client-side row filter with no agglvl check, so a 5-digit county FIPS
    # needs no connector change. Verified live 2026-07-25: 3,707 private
    # areas, each at exactly one agglvl_code.
    obs = qcew.fetch(["51107", "48441"], vintage_date="2026-07-12",
                     http_get=fake_get)
    assert {o.series_code for o in obs} == {"51107", "48441"}


def test_suppressed_county_yields_neither_wage_nor_employment():
    # Washington Co. OR (41067) is disclosure_code "N". A suppressed row must
    # produce no observation at all — not a 0 wage, and not a 0 headcount.
    obs = qcew.fetch(["41067", "41067~emp", "41067~aemp"], vintage_date="2026-07-12",
                     http_get=fake_get)
    assert obs == []


def test_employment_requested_alone_does_not_emit_the_wage_series():
    obs = qcew.fetch(["48441~emp"], vintage_date="2026-07-12", http_get=fake_get)
    assert {o.series_code for o in obs} == {"48441~emp"}
    assert obs[0].value == 4106.0


def test_emits_average_monthly_employment_as_its_own_series():
    # BLS's own denominator for avg_wkly_wage is AVERAGE monthly employment
    # ((m1+m2+m3)/3), not the point-in-time month3 headcount ~emp already
    # rides — empirically, total_qtrly_wages/((m1+m2+m3)/3)/13 reproduces
    # published avg_wkly_wage within integer rounding for 100% of rows,
    # while a month3 denominator does so for ~2-3%. It becomes its OWN
    # series code (not a new Observation field), same evolution path as
    # ~emp: store rows are append-only and schema-versionless.
    obs = qcew.fetch(["51107", "51107~emp", "51107~aemp"],
                     vintage_date="2026-07-12", http_get=fake_get)
    by_code = {o.series_code: o for o in obs}
    assert set(by_code) == {"51107", "51107~emp", "51107~aemp"}
    assert by_code["51107~aemp"].value == pytest.approx((25980 + 26050 + 26151) / 3)
    assert by_code["51107~aemp"].obs_date == "2025-10-01"
    assert by_code["51107~aemp"].source == "QCEW"
    assert by_code["51107~aemp"].route == "CSV"
    # month3 (~emp) stays exactly what it already was -- this is additive,
    # not a replacement.
    assert by_code["51107~emp"].value == 26151.0


def test_average_employment_requested_alone_does_not_emit_wage_or_month3():
    obs = qcew.fetch(["48441~aemp"], vintage_date="2026-07-12", http_get=fake_get)
    assert {o.series_code for o in obs} == {"48441~aemp"}
    assert obs[0].value == pytest.approx((4050 + 4080 + 4106) / 3)


# --- NAICS 238212 (nonresidential electrical contractors) -------------------
# Fixtures are the live 2026/1 and 2025/1 /industry/238212.csv files (fetched
# 2026-10-01), trimmed to the header plus: US000 own 3 and own 5 (agglvl 18),
# Virginia 51000 (agglvl 58), and counties 51107/51153/19153/32031 (published)
# and 19049/32029/22083 (disclosure code N in 2026q1) at agglvl 78.

FIXTURE_ELEC = Path(__file__).parent / "fixtures" / "qcew_industry238212.csv"
FIXTURE_ELEC_YA = Path(__file__).parent / "fixtures" / "qcew_industry238212_2025q1.csv"


def elec_get(url, timeout=None, **kw):
    assert "data.bls.gov/cew/data/api/" in url and url.endswith("/industry/238212.csv")
    if "/2026/1/" in url:
        return _Resp(FIXTURE_ELEC.read_text())
    if "/2025/1/" in url:
        return _Resp(FIXTURE_ELEC_YA.read_text())
    return _Resp("", status=404)


def _elec(ids, get=elec_get, vintage="2026-10-01"):
    return qcew.fetch(ids, vintage_date=vintage, http_get=get,
                      naics=qcew.NAICS_ELEC, source="QCEW_238212")


def test_238212_reads_the_6_digit_industry_slice_tagged_with_its_own_source():
    obs = _elec(["51107", "51107~emp", "51107~aemp"])
    got = {(o.series_code, o.obs_date): o.value for o in obs}
    assert got == {
        ("51107", "2026-01-01"): 2392.0, ("51107~emp", "2026-01-01"): 13638.0,
        ("51107~aemp", "2026-01-01"): pytest.approx((12833 + 13248 + 13638) / 3),
        ("51107", "2025-01-01"): 2218.0, ("51107~emp", "2025-01-01"): 9932.0,
        ("51107~aemp", "2025-01-01"): pytest.approx((9440 + 9700 + 9932) / 3)}
    assert all(o.source == "QCEW_238212" and o.route == "CSV" for o in obs)


def test_238212_national_row_is_private_ownership_only():
    obs = _elec(["US000", "US000~emp"])
    jan = {o.series_code: o.value for o in obs if o.obs_date == "2026-01-01"}
    assert jan == {"US000": 1869.0, "US000~emp": 802677.0}  # own 5, not own 3 ($1,299)


def test_238212_suppressed_counties_are_skipped_never_zero():
    # Dallas IA, Storey NV, Richland Parish LA print "N" with zeroed cells.
    obs = _elec([f"{f}{s}" for f in ("19049", "32029", "22083")
                 for s in ("", "~emp", "~aemp")])
    # 19049 printed in 2025q1; its 2026q1 is suppressed. 32029/22083: nothing.
    assert {(o.series_code, o.obs_date) for o in obs} == {
        ("19049", "2025-01-01"), ("19049~emp", "2025-01-01"),
        ("19049~aemp", "2025-01-01")}
    assert all(o.value > 0 for o in obs)


def test_238212_wrong_industry_file_is_drift_not_data():
    # A NAICS 23 body served at the 238212 URL must never be ingested as
    # electrical contractors: every quarter fails the industry_code guard.
    def wrong_get(url, timeout=None, **kw):
        return _Resp(FIXTURE.read_text())
    with pytest.raises(RuntimeError, match="QCEW_238212: no quarter loaded"):
        _elec(["US000"], get=wrong_get)


def _mutate(text, fips, col, value):
    lines = text.splitlines()
    i = [h.strip('"') for h in lines[0].split(",")].index(col)
    out = []
    for line in lines:
        cells = line.split(",")
        if cells[0] == f'"{fips}"' and cells[1] == '"5"':
            cells[i] = value
        out.append(",".join(cells))
    return "\n".join(out) + "\n"


@pytest.mark.parametrize("col,value,msg", [
    ("agglvl_code", '"74"', "agglvl_code"),                       # 5-digit-level row
    ("avg_wkly_wage", "239200", "implausible avg_wkly_wage"),      # cents for dollars
    ("month3_emplvl", "411623715", "implausible month3_emplvl"),   # wages column
])
def test_238212_drift_guard_drops_only_the_bad_quarter(col, value, msg):
    from pipeline.connectors.util import PartialFetchWarning
    bad = _mutate(FIXTURE_ELEC.read_text(), "51107", col, value)

    def get(url, timeout=None, **kw):
        if "/2026/1/" in url:
            return _Resp(bad)
        return elec_get(url, timeout)

    with pytest.warns(PartialFetchWarning, match=msg):
        obs = _elec(["51107"], get=get)
    # the good year-ago quarter still loads; the drifted one is not ingested
    assert {o.obs_date for o in obs} == {"2025-01-01"}


def test_naics_23_path_carries_no_6_digit_guards():
    # Byte-identical NAICS 23 behaviour: the guards are keyed to 238212 only,
    # so a NAICS 23 county row (agglvl 74 in the fixture) still ingests.
    assert qcew.NAICS not in qcew._GUARDS
    obs = qcew.fetch(["51107"], vintage_date="2026-07-12", http_get=fake_get)
    assert {o.value for o in obs} == {2264.0}


def test_collect_routes_238212_series_to_their_own_codes(tmp_path):
    from pipeline import collect, registry
    from pipeline.store import vintage
    sources, series = registry.load_registry()
    subset = [s for s in series if s.source == "QCEW_238212"]
    results = collect.collect_all({"QCEW_238212": sources["QCEW_238212"]}, subset,
                                  {}, tmp_path, http_get=elec_get, http_post=None)
    assert [(r.source, r.ok) for r in results] == [("QCEW_238212", True)]
    conn = vintage.load(tmp_path)
    assert dict(vintage.latest(conn, "qcew_wage238212_c51107")) == {
        "2025-01-01": 2218.0, "2026-01-01": 2392.0}
    # same source_id "51107" under QCEW never leaks into the NAICS 23 code
    assert dict(vintage.latest(conn, "qcew_wage23_c51107")) == {}
