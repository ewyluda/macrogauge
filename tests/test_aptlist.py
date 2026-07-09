import pathlib

from pipeline.connectors import aptlist

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def test_fetch_parses_national_monthly_rows():
    csv_text = (FIXTURES / "aptlist.csv").read_text()

    def fake_get(url, timeout=None):
        return FakeResponse(csv_text)

    obs = aptlist.fetch(vintage_date="2026-07-10", http_get=fake_get)
    assert all(o.series_code == "aptlist_us" for o in obs)
    assert all(o.source == "APTLIST" and o.route == "CSV" for o in obs)
    assert all(o.obs_date.endswith("-01") for o in obs)
    assert all(o.obs_date >= "2017-01-01" for o in obs)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates) and len(dates) >= 12


def test_fetch_raises_when_national_row_missing():
    def fake_get(url, timeout=None):
        return FakeResponse('"location_name","bed_size","2017_01"\n"Denver, CO","overall","1400"\n')

    try:
        aptlist.fetch(vintage_date="2026-07-10", http_get=fake_get)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "National" in str(e)
