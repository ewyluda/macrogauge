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


# --- fetch_states (P2 T4): 51-state regular grade off the state-averages page ---

def _states_html():
    return (FIXTURES / "aaa_states.html").read_text()


def test_fetch_states_extracts_all_51_states():
    html = _states_html()
    obs = aaa.fetch_states(vintage_date="2026-07-17", http_get=_fake_get_for(html))
    assert len(obs) == 51
    by_code = {o.series_code: o.value for o in obs}
    assert len(by_code) == 51
    # codes are the href abbrevs lowercased (collect's id_map remaps to aaa_gas_{st})
    assert all(re.fullmatch(r"[a-z]{2}", c) for c in by_code)
    assert "dc" in by_code
    # spot-check against the recorded 2026-07-17 snapshot
    assert by_code["ak"] == 4.678
    assert by_code["ca"] == 5.43
    assert by_code["tx"] == 3.568
    assert by_code["ny"] == 4.118
    for o in obs:
        assert o.source == "AAA_STATE" and o.route == "SCRAPE"
        assert o.obs_date == o.vintage_date == "2026-07-17"


def test_fetch_states_ignores_national_banner():
    # the fixture keeps the page's national-average banner ($3.9810) on purpose:
    # parsing is sliced to the sortable table, so it must never cross-match
    html = _states_html()
    assert "AAA National Average $3.9810" in html
    obs = aaa.fetch_states(vintage_date="2026-07-17", http_get=_fake_get_for(html))
    assert all(o.value != 3.981 for o in obs)


def test_fetch_states_raises_when_table_missing():
    try:
        aaa.fetch_states(vintage_date="2026-07-17",
                         http_get=_fake_get_for("<html><body>redesigned</body></html>"))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "structure drift" in str(e)


def test_fetch_states_raises_on_row_count_drift():
    # break one row's anchor so only 50 parse — exactly 51 is the contract
    drifted = _states_html().replace(
        "https://gasprices.aaa.com?state=AK", "https://gasprices.aaa.com?stat=AK", 1)
    try:
        aaa.fetch_states(vintage_date="2026-07-17", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "50" in str(e) and "structure drift" in str(e)


def test_fetch_states_raises_on_implausible_price():
    drifted = _states_html().replace("$4.6780", "$9.9990")  # AK regular
    try:
        aaa.fetch_states(vintage_date="2026-07-17", http_get=_fake_get_for(drifted))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "implausible" in str(e)
