import pathlib
import re

from pipeline.connectors import aaa

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _fake_get_for(text):
    def fake_get(url, timeout=None):
        return FakeResponse(text)
    return fake_get


def test_fetch_extracts_national_average():
    html = (FIXTURES / "aaa.html").read_text()
    obs = aaa.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(html))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "aaa_gas_d"
    assert o.source == "AAA" and o.route == "SCRAPE"
    assert o.obs_date == o.vintage_date == "2026-07-10"
    assert o.value == 3.846  # matches the fixture's real "Today's AAA National Average" value


def test_fetch_raises_on_structure_drift():
    try:
        aaa.fetch(vintage_date="2026-07-10",
                  http_get=_fake_get_for("<html><body>redesigned</body></html>"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "national average" in str(e)


def test_fetch_raises_on_implausible_value():
    html = (FIXTURES / "aaa.html").read_text()
    # fixture's real format is $D.DDDD (4 decimals), not the $D.DDD the plan assumed —
    # swap in a same-shaped-but-implausible value so it still matches PRICE_RE and
    # exercises the plausibility check rather than the "not found" branch.
    drifted = html.replace(_first_price(html), "$9.9990")
    try:
        aaa.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "implausible" in str(e)


def _first_price(html):
    return re.search(r"\$\d\.\d{4}", html).group(0)
