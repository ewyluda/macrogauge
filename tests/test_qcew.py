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
