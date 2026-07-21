from pathlib import Path

import pytest

from pipeline.connectors import zillow

FIXTURES = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def fake_get(url, timeout=None):
    if url == zillow.ZORI_URL:
        return FakeResponse((FIXTURES / "zillow_zori.csv").read_text())
    if url == zillow.ZHVI_URL:
        return FakeResponse((FIXTURES / "zillow_zhvi.csv").read_text())
    raise AssertionError(f"unexpected url {url}")


def test_fetch_us_rows_since_2017():
    obs = zillow.fetch(["zori", "zhvi"], vintage_date="2026-07-07",
                       http_get=fake_get)
    zori = [o for o in obs if o.series_code == "zori"]
    zhvi = [o for o in obs if o.series_code == "zhvi"]
    # 2016-12 column is before the 2017-01-01 start and must be excluded
    assert [(o.obs_date, o.value) for o in zori] == [("2017-01-01", 1400.1),
                                                     ("2026-05-01", 2105.7)]
    assert [(o.obs_date, o.value) for o in zhvi] == [("2017-01-01", 196000.0),
                                                     ("2026-05-01", 361500.0)]
    assert zori[0].source == "ZILLOW" and zori[0].route == "CSV"
    # metro rows exist in the fixtures but were not requested
    assert {o.series_code for o in obs} == {"zori", "zhvi"}


def test_fetch_metro_rows_for_registered_ids():
    obs = zillow.fetch(["zori", "zhvi", "zori:394913", "zhvi:394913"],
                       vintage_date="2026-07-07", http_get=fake_get)
    ny_rent = [o for o in obs if o.series_code == "zori:394913"]
    ny_home = [o for o in obs if o.series_code == "zhvi:394913"]
    assert [(o.obs_date, o.value) for o in ny_rent] == [("2017-01-01", 2400.0),
                                                        ("2026-05-01", 3300.2)]
    assert [(o.obs_date, o.value) for o in ny_home] == [("2017-01-01", 430000.0),
                                                        ("2026-05-01", 660000.0)]
    assert ny_rent[0].source == "ZILLOW" and ny_rent[0].route == "CSV"
    # the US rows still come through alongside the metros
    assert any(o.series_code == "zori" for o in obs)
    assert any(o.series_code == "zhvi" for o in obs)


def test_fetch_drops_unregistered_msa_rows():
    # Rochester (395031) is an msa row in both fixtures but is not requested
    obs = zillow.fetch(["zori", "zhvi", "zori:394913", "zhvi:394913"],
                       vintage_date="2026-07-07", http_get=fake_get)
    assert not any("395031" in o.series_code for o in obs)


def test_fetch_tolerates_absent_registered_metro():
    # a registered RegionID missing from the file is skipped (metros come and
    # go) as long as at least one requested metro row is found
    obs = zillow.fetch(["zori", "zori:394913", "zori:999999"],
                       vintage_date="2026-07-07", http_get=fake_get)
    assert {o.series_code for o in obs} == {"zori", "zori:394913"}


def test_fetch_zero_metros_preserves_us_row():
    # When every requested metro vanishes from a file, the US anchor row (US
    # shelter is the largest CPI weight) must still be emitted — the missing
    # metros surface via the per-series staleness QA, like other speculative
    # series, NOT by discarding the core row (review finding, 2026-07-17).
    obs = zillow.fetch(["zori", "zori:999999"], vintage_date="2026-07-07",
                       http_get=fake_get)
    assert {o.series_code for o in obs} == {"zori"}


def _strip_us(fixture_name):
    text = (FIXTURES / fixture_name).read_text()
    header, *rows = text.splitlines()
    return "\n".join([header] + [r for r in rows if "United States" not in r])


def test_fetch_missing_us_row_raises():
    def headers_only_get(url, timeout=None):
        return FakeResponse(_strip_us("zillow_zori.csv"))

    with pytest.raises(ValueError, match="United States"):
        zillow.fetch(["zori"], vintage_date="2026-07-07",
                     http_get=headers_only_get)


def test_fetch_per_file_isolation_zhvi_survives_zori_drift():
    # A drift that breaks the ZORI file (US row gone) must not skip the ZHVI
    # fetch — per-file isolation, like fred per-series / qcew per-quarter.
    def zori_broken(url, timeout=None):
        if url == zillow.ZORI_URL:
            return FakeResponse(_strip_us("zillow_zori.csv"))
        return FakeResponse((FIXTURES / "zillow_zhvi.csv").read_text())

    obs = zillow.fetch(["zori", "zhvi"], vintage_date="2026-07-07",
                       http_get=zori_broken)
    assert any(o.series_code == "zhvi" for o in obs)   # zhvi came through
    assert not any(o.series_code == "zori" for o in obs)  # zori file failed


def test_fetch_all_files_failing_raises():
    def both_broken(url, timeout=None):
        return FakeResponse(_strip_us("zillow_zori.csv"))

    with pytest.raises((ValueError, RuntimeError)):
        zillow.fetch(["zori", "zhvi"], vintage_date="2026-07-07",
                     http_get=both_broken)


def test_fetch_malformed_metro_cell_keeps_us_row():
    # Per-row isolation inside a file: a garbage cell in one metro row must
    # drop only that metro, never the already-parsed US row or other metros.
    def zori_bad_metro(url, timeout=None):
        if url == zillow.ZORI_URL:
            text = (FIXTURES / "zillow_zori.csv").read_text()
            return FakeResponse(text.replace("2400.0", "N/A"))  # NY 2017-01 cell
        return FakeResponse((FIXTURES / "zillow_zhvi.csv").read_text())

    obs = zillow.fetch(["zori", "zori:394913", "zhvi"], vintage_date="2026-07-07",
                       http_get=zori_bad_metro)
    assert any(o.series_code == "zori" for o in obs)          # US row survives
    assert not any(o.series_code == "zori:394913" for o in obs)  # bad metro dropped
    assert any(o.series_code == "zhvi" for o in obs)


def test_fetch_partial_file_failure_emits_warning():
    from pipeline.connectors.util import PartialFetchWarning

    def zori_broken(url, timeout=None):
        if url == zillow.ZORI_URL:
            return FakeResponse(_strip_us("zillow_zori.csv"))
        return FakeResponse((FIXTURES / "zillow_zhvi.csv").read_text())

    with pytest.warns(PartialFetchWarning, match="zori: ValueError"):
        zillow.fetch(["zori", "zhvi"], vintage_date="2026-07-07",
                     http_get=zori_broken)
