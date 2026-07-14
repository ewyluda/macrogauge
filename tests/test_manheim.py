import pathlib

import pytest

from pipeline.connectors import manheim

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
# Recorded from the re-point spike (2026-07-13) against the live Cox
# Automotive Insights feed + post: the latest trends report is "June 2026
# Trends" (full-month update, published Jul 8), value 212.9.
EXPECTED_MONTH = "2026-06-01"
EXPECTED_VALUE = 212.9
POST_URL = ("https://www.coxautoinc.com/insights/"
            "manheim-used-vehicle-value-index-june-2026-trends/")


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _fake_get_for(feed_text, post_text):
    def fake_get(url, timeout=None):
        if url == manheim.FEED_URL:
            return FakeResponse(feed_text)
        if url == POST_URL:
            return FakeResponse(post_text)
        raise AssertionError(f"unexpected url {url}")
    return fake_get


def _fixtures():
    return ((FIXTURES / "manheim_feed.xml").read_text(),
            (FIXTURES / "manheim_post.html").read_text())


def test_fixture_carries_decoy_muvvi_items_before_trends_post():
    # Guard the recorded feed: other MUVVI-titled items (conference-call
    # replay, quarterly commentary) sit AHEAD of the trends post in feed
    # order. If a refreshed fixture ever loses them, the selection tests
    # below stop proving title anchoring.
    feed, _ = _fixtures()
    trends = feed.index("Manheim Used Vehicle Value Index: June 2026 Trends")
    assert feed.index("Replay Available: Q2 2026 Manheim Used Vehicle Value Index Call") < trends
    assert feed.index("Manheim Used Vehicle Value Index Normalizes in Q2") < trends


def test_fetch_extracts_latest_index_and_month():
    feed, post = _fixtures()
    obs = manheim.fetch(vintage_date="2026-07-13",
                        http_get=_fake_get_for(feed, post))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "manheim_uvvi_m"
    assert o.source == "MANHEIM" and o.route == "SCRAPE"
    assert o.obs_date == EXPECTED_MONTH
    assert o.vintage_date == "2026-07-13"
    # _fake_get_for only answers the June trends POST_URL, so reaching a
    # value at all proves the "... Trends"-titled item (not the replay or
    # quarterly-commentary decoys ahead of it) was selected; the exact
    # value proves the heading→"(MUVVI) <verb> to" anchor on the post.
    assert o.value == pytest.approx(EXPECTED_VALUE)


def test_fetch_mid_month_report_maps_to_same_reference_month():
    # Mid-month update titles carry a "Mid-" prefix ("Mid-June 2026
    # Trends") but reference the same month; the full-month figure later
    # appends a fresh vintage row for the same obs_date.
    feed, post = _fixtures()
    feed = feed.replace("June 2026 Trends", "Mid-June 2026 Trends")
    post = post.replace("June 2026 Trends", "Mid-June 2026 Trends")
    obs = manheim.fetch(vintage_date="2026-07-13",
                        http_get=_fake_get_for(feed, post))
    assert obs[0].obs_date == EXPECTED_MONTH
    assert obs[0].value == pytest.approx(EXPECTED_VALUE)


def test_fetch_reads_h1_anchored_value_not_head_metadata_decoy():
    # The March 2026 post (recorded 2026-07-13) carries two traps the June
    # post lacks: a JSON-LD description in <head> stating "(MUVVI)
    # increased to 209.2" — a stale boilerplate value, identical across the
    # Feb–May 2026 posts — and &nbsp; entities inside the real prose clause
    # ("(MUVVI)&nbsp;rose&nbsp;to&nbsp;215.3"). A <title>-anchored scan
    # returns the decoy 209.2 and slipped four wrong months into the store
    # before being caught; the <h1> anchor + entity normalization must
    # return the prose value.
    feed, _ = _fixtures()
    march = (FIXTURES / "manheim_post_march.html").read_text()
    obs = manheim.fetch(vintage_date="2026-07-13",
                        http_get=_fake_get_for(feed, march))
    assert obs[0].obs_date == "2026-03-01"
    assert obs[0].value == pytest.approx(215.3)
    assert obs[0].value != pytest.approx(209.2)


def test_march_fixture_still_carries_both_traps():
    # Guard the recorded fixture: if a refresh ever loses the <head> decoy
    # sentence or the &nbsp;-encoded prose clause, the test above stops
    # proving anything.
    march = (FIXTURES / "manheim_post_march.html").read_text()
    assert "increased to 209.2" in march
    assert "(MUVVI)&nbsp;rose&nbsp;to&nbsp;215.3" in march


def test_fetch_raises_on_feed_drift():
    _, post = _fixtures()
    with pytest.raises(ValueError, match="structure drift"):
        manheim.fetch(vintage_date="2026-07-13",
                      http_get=_fake_get_for("<rss><channel></channel></rss>", post))


def test_fetch_raises_on_post_drift():
    feed, _ = _fixtures()
    with pytest.raises(ValueError, match="UVVI"):
        manheim.fetch(vintage_date="2026-07-13",
                      http_get=_fake_get_for(feed, "<html><body>redesigned</body></html>"))


def test_fetch_raises_on_implausible_value():
    feed, post = _fixtures()
    assert post.count("212.9") == 1  # guard: prose states the value exactly once
    with pytest.raises(ValueError, match="implausible"):
        manheim.fetch(vintage_date="2026-07-13",
                      http_get=_fake_get_for(feed, post.replace("212.9", "999.9")))
