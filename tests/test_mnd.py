import pathlib
import re

from pipeline.connectors import mnd

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


def test_fetch_extracts_30yr_rate():
    html = (FIXTURES / "mnd.html").read_text()
    obs = mnd.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(html))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "mnd_30y_d"
    assert o.source == "MND" and o.route == "SCRAPE"
    assert o.obs_date == o.vintage_date == "2026-07-10"
    assert o.value == 6.65  # matches the fixture's "MND's 30 Year Fixed (daily survey)" row


def test_fetch_raises_on_structure_drift():
    try:
        mnd.fetch(vintage_date="2026-07-10",
                  http_get=_fake_get_for("<html><body>redesigned</body></html>"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "30yr rate" in str(e)


def test_fetch_raises_on_implausible_value():
    html = (FIXTURES / "mnd.html").read_text()
    # RATE_RE's group is a single digit before the decimal (matches the fixture's
    # real D.DD shape), so a same-shaped-but-implausible replacement must stay
    # single-digit — "29.99" would let the regex re-anchor mid-string ("9.99",
    # still in [2.0, 12.0], no error). Go below the 2.0 floor instead, same
    # pattern test_aaa.py uses for its $9.9990 replacement.
    drifted = html.replace(_first_rate(html), "1.11")
    try:
        mnd.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "implausible" in str(e)


def test_fetch_captures_double_digit_rate():
    """Regression: double-digit rates (10.25) must be captured directly,
    not fall through to Prior Year decoy (6.77). RATE_RE capture must be
    \\d{1,2}\\.\\d{2}, not single-digit \\d\\.\\d{2}."""
    html = (FIXTURES / "mnd.html").read_text()
    # Replace the fixture's target rate "6.65" with "10.25" (double-digit, still plausible)
    drifted = html.replace(_first_rate(html), "10.25")
    obs = mnd.fetch(vintage_date="2026-07-10", http_get=_fake_get_for(drifted))
    assert len(obs) == 1
    assert obs[0].value == 10.25  # Not 6.77 (the Prior Year decoy)


def _first_rate(html):
    return re.search(r"\d\.\d{2}(?=%)", html).group(0)
