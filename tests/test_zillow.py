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


def test_fetch_zero_metros_when_requested_raises():
    with pytest.raises(ValueError, match="structure drift"):
        zillow.fetch(["zori", "zori:999999"], vintage_date="2026-07-07",
                     http_get=fake_get)


def test_fetch_missing_us_row_raises():
    def headers_only_get(url, timeout=None):
        text = (FIXTURES / "zillow_zori.csv").read_text()
        header, *rows = text.splitlines()
        no_us = "\n".join([header] + [r for r in rows if "United States" not in r])
        return FakeResponse(no_us)

    with pytest.raises(ValueError, match="United States"):
        zillow.fetch(["zori"], vintage_date="2026-07-07",
                     http_get=headers_only_get)
