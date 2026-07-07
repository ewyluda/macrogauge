from pathlib import Path

from pipeline.connectors import pmms

FIXTURE = Path(__file__).parent / "fixtures" / "pmms.csv"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def fake_get(url, timeout=None):
    assert url == pmms.PMMS_URL
    return FakeResponse(FIXTURE.read_text())


def test_fetch_weekly_30yr_iso_dates():
    obs = pmms.fetch(vintage_date="2026-07-07", http_get=fake_get)
    assert [(o.obs_date, o.value) for o in obs] == [("2017-01-05", 4.20),
                                                    ("2026-07-02", 6.31)]
    assert obs[0].series_code == "pmms_30yr"
    assert obs[0].source == "PMMS" and obs[0].route == "CSV"
