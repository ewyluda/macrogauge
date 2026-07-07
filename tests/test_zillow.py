from pathlib import Path

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


def test_fetch_us_row_only_since_2017():
    obs = zillow.fetch(vintage_date="2026-07-07", http_get=fake_get)
    zori = [o for o in obs if o.series_code == "zori_us"]
    zhvi = [o for o in obs if o.series_code == "zhvi_us"]
    # 2016-12 column is before the 2017-01-01 start and must be excluded
    assert [(o.obs_date, o.value) for o in zori] == [("2017-01-01", 1400.1),
                                                     ("2026-05-01", 2105.7)]
    assert [(o.obs_date, o.value) for o in zhvi] == [("2017-01-01", 196000.0),
                                                     ("2026-05-01", 361500.0)]
    assert zori[0].source == "ZILLOW" and zori[0].route == "CSV"
