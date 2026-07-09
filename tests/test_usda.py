import json
import pathlib

from pipeline.connectors import usda

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        pass


def test_fetch_parses_weekly_national_prices():
    fixture = json.loads((FIXTURES / "usda_report.json").read_text())

    def fake_get(url, params=None, timeout=None, **kw):
        return FakeResponse(fixture)

    # "3228:beef" -- slug 3228 (Weekly Grocery Store Beef Feature Activity),
    # the ground-beef-80-89%/Conventional/Fresh national staple (spike table,
    # task-6-report.md). Single-query staple, so one fake_get call covers it.
    obs = usda.fetch(["3228:beef"], "k", vintage_date="2026-07-10", http_get=fake_get)
    assert obs, "no observations parsed"
    assert all(o.source == "USDA" and o.route == "API" for o in obs)
    assert all(o.value > 0 for o in obs)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates)
    # fixture has 3 distinct matching report_dates (06/29, 06/22, 06/15);
    # 06/08's row is a real row with price_avg blanked to simulate the gap
    # USDA reports do have -- it must be skipped, not zero-filled.
    assert len(obs) == 3
    assert "2026-06-08" not in dates
    # 06/29 has four package-size rows (386, 2561, 425, 7304 stores) that must
    # weighted-average, not simple-average -- pins the aggregation math.
    by_date = {o.obs_date: o.value for o in obs}
    expected = (4.25 * 386 + 6.28 * 2561 + 4.42 * 425 + 5.63 * 7304) / (386 + 2561 + 425 + 7304)
    assert round(by_date["2026-06-29"], 4) == round(expected, 4)


def test_fetch_skips_rows_without_price():
    def fake_get(url, params=None, timeout=None, **kw):
        return FakeResponse({"results": [{"report_date": "07/04/2026"}]})

    obs = usda.fetch(["3228:beef"], "k", vintage_date="2026-07-10", http_get=fake_get)
    assert obs == []
