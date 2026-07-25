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


def test_window_reaches_the_year_ago_base_of_the_newest_published_quarter():
    # QCEW publishes ~2 quarters behind, so on 2026-07-25 the newest published
    # quarter is 2025q4. Its YoY base is 2024q4. A window that stops short of
    # that base can never compute a wage YoY — which is exactly why geo.json
    # shipped yoy_pct: null for all 51 states before this fix.
    window = qcew._recent_quarters("2026-07-25")
    assert (2025, 4) in window, "newest published quarter missing"
    assert (2024, 4) in window, "year-ago base missing — YoY impossible"


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
    obs = qcew.fetch(["41067", "41067~emp"], vintage_date="2026-07-12",
                     http_get=fake_get)
    assert obs == []


def test_employment_requested_alone_does_not_emit_the_wage_series():
    obs = qcew.fetch(["48441~emp"], vintage_date="2026-07-12", http_get=fake_get)
    assert {o.series_code for o in obs} == {"48441~emp"}
    assert obs[0].value == 4106.0
