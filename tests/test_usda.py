import json
import pathlib

import pytest

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


def test_fetch_rejects_registry_slug_mismatched_with_connector_config():
    # config/series.json's source_id encodes the report slug (e.g. "3228:beef");
    # the connector's own STAPLE_CONFIG["beef"]["slug"] is what actually drives
    # the request. If a config edit ever diverges the two, that must fail loudly
    # (surfacing in sources_status.json) instead of being silently ignored.
    def fake_get(url, params=None, timeout=None, **kw):
        raise AssertionError("must not fetch when the registry slug is invalid")

    with pytest.raises(ValueError, match="9999:beef: registry slug 9999 != connector config 3228"):
        usda.fetch(["9999:beef"], "k", vintage_date="2026-07-10", http_get=fake_get)


def test_fetch_milk_uses_report_end_date_not_report_date():
    # Dairy rows carry no "report_date" key at all (module docstring) -- obs_date
    # must derive from report_end_date instead. Also pins store-count-weighted
    # averaging across multiple same-date rows and type-field filtering
    # ("2% Reduced Fat" must not blend into the "All Fat Tests" series).
    fixture = json.loads((FIXTURES / "usda_milk.json").read_text())
    assert all("report_date" not in row for row in fixture["results"])

    def fake_get(url, params=None, timeout=None, **kw):
        return FakeResponse(fixture)

    obs = usda.fetch(["2995:milk"], "k", vintage_date="2026-07-10", http_get=fake_get)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates)
    assert len(obs) == 2
    assert "2026-06-13" not in dates  # null wtd_avg_price row must be skipped

    by_date = {o.obs_date: o.value for o in obs}
    expected_0627 = (3.98 * 1200 + 4.10 * 800) / (1200 + 800)
    assert round(by_date["2026-06-27"], 4) == round(expected_0627, 4)
    assert round(by_date["2026-06-20"], 4) == 4.05


def test_fetch_broiler_uses_volume_wtd_avg_price_and_item_fields():
    # Broiler's field names differ from the retail reports: price is
    # wtd_avg_price, weight is volume, and the type-match field is "item"
    # rather than "type" -- "Whole Broiler/Fryer" rows must not blend into
    # the "RTC Broiler/Fryer" series.
    fixture = json.loads((FIXTURES / "usda_broiler.json").read_text())

    def fake_get(url, params=None, timeout=None, **kw):
        return FakeResponse(fixture)

    obs = usda.fetch(["3646:broiler"], "k", vintage_date="2026-07-10", http_get=fake_get)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates)
    assert len(obs) == 2

    by_date = {o.obs_date: o.value for o in obs}
    expected_0625 = (1.35 * 2_500_000 + 1.42 * 1_800_000) / (2_500_000 + 1_800_000)
    assert round(by_date["2026-06-25"], 4) == round(expected_0625, 4)
    assert round(by_date["2026-06-18"], 4) == 1.30


def test_fetch_pork_prefix_match_and_windows_do_not_double_count():
    # Pork's 3 date-partitioned windows carry no server-side type filter (the
    # legacy label's embedded comma breaks the filter DSL), so matching is by
    # client-side prefix ("SLICED BACON" / "Sliced Bacon" both match; "CANADIAN
    # BACON" and "Peppered Bacon" must not). Window 2's fixture also repeats,
    # byte-for-byte, one row already returned by window 1 for the same date
    # (12/29/2019) -- simulating adjacent windows both surfacing the same
    # underlying report near their shared boundary -- alongside a genuinely
    # distinct second row for that date with different price/weight. If the
    # connector's content-based dedupe (date, price, weight) ever regressed,
    # the duplicate would inflate that date's weighted average.
    fixture = json.loads((FIXTURES / "usda_pork.json").read_text())

    def fake_get(url, params=None, timeout=None, **kw):
        q = params["q"]
        if "12/31/2019" in q:
            return FakeResponse(fixture["w1"])
        if "12/31/2022" in q:
            return FakeResponse(fixture["w2"])
        return FakeResponse(fixture["w3"])

    obs = usda.fetch(["2868:pork"], "k", vintage_date="2026-07-10", http_get=fake_get)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates)
    assert len(obs) == 4
    assert "2020-07-07" not in dates  # null price_avg row must be skipped

    by_date = {o.obs_date: o.value for o in obs}
    expected_0115 = (3.10 * 400 + 3.30 * 250) / (400 + 250)
    assert round(by_date["2019-01-15"], 4) == round(expected_0115, 4)
    # The duplicate (3.49, 500) must count once, not twice, alongside the
    # genuinely distinct (3.80, 200) row -- (3.49*500 + 3.80*200) / 700, not
    # (3.49*1000 + 3.80*200) / 1200.
    expected_1229 = (3.49 * 500 + 3.80 * 200) / (500 + 200)
    assert round(by_date["2019-12-29"], 4) == round(expected_1229, 4)
    assert round(by_date["2024-03-10"], 4) == 4.10
    assert round(by_date["2024-11-20"], 4) == 4.55  # "Peppered Bacon" excluded


def test_fetch_eggs_bridges_pre_and_post_rename_type_labels_to_one_series():
    # Eggs' "type" label was renamed+reordered ("WHITE LARGE" -> "Large White")
    # partway through history; the connector issues two separate queries (one
    # per label spelling) and both must land in the same output series.
    pre = json.loads((FIXTURES / "usda_eggs_pre.json").read_text())
    post = json.loads((FIXTURES / "usda_eggs_post.json").read_text())

    def fake_get(url, params=None, timeout=None, **kw):
        q = params["q"]
        if "type=WHITE LARGE" in q:
            return FakeResponse(pre)
        assert "type=Large White" in q
        return FakeResponse(post)

    obs = usda.fetch(["2757:eggs"], "k", vintage_date="2026-07-10", http_get=fake_get)
    assert all(o.series_code == "2757:eggs" for o in obs)
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates)
    assert len(obs) == 2  # "BROWN LARGE"/"Brown Large" decoys excluded from both

    by_date = {o.obs_date: o.value for o in obs}
    assert round(by_date["2023-12-25"], 4) == 2.10  # pre-rename "WHITE LARGE"
    assert round(by_date["2026-07-01"], 4) == 3.45   # post-rename "Large White"
