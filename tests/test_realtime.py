"""Backlog #2 (2026-09-28): the vintage-true month-end gauge track.

The hindsight daily history applies month m's official print from m-01, ~6
weeks before BLS released it. The real-time track reads each component at
its latest observation AVAILABLE on the month-end: official points from
their CPI release date, live points after the source's publication lag;
publish-ledger rows (what the site actually said) win where they exist."""
from pathlib import Path

import pytest

from pipeline.engine import realtime
from pipeline.models import Observation
from pipeline.publish import compare, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def test_typical_lag_uses_genuine_arrivals_only():
    rows = [("2017-01-01", 1.0, "2026-07-07"),   # initial backfill vintage
            ("2026-05-01", 1.0, "2026-07-07"),   # also backfill
            ("2026-03-01", 1.0, "2026-07-20"),   # later re-pull, 141d: not genuine
            ("2026-06-01", 1.0, "2026-07-16"),   # 45
            ("2026-07-01", 1.0, "2026-08-17"),   # 47
            ("2026-08-01", 1.0, "2026-09-16")]   # 46
    assert realtime.typical_lag(rows) == 46
    assert realtime.typical_lag([("2026-06-01", 1.0, "2026-07-16"),
                                 ("2026-07-01", 1.0, "2026-08-10"),
                                 ("2026-08-01", 1.0, "2026-09-15")]) == 43  # initial excluded; 40, 45 -> 42.5 -> 43
    assert realtime.typical_lag([]) == 0
    assert realtime.typical_lag([("2026-01-01", 1.0, "2026-07-07")]) == 0


def test_typical_lag_rounds_a_half_median_up():
    rows = [("2026-01-01", 1.0, "2026-01-01"),  # initial
            ("2026-02-01", 1.0, "2026-02-11"),  # 10
            ("2026-03-01", 1.0, "2026-03-12")]  # 11 -> median 10.5 -> 11
    assert realtime.typical_lag(rows) == 11


def test_month_end_handles_december_and_cap():
    assert realtime.month_end("2019-02-01", "2030-01-01") == "2019-02-28"
    assert realtime.month_end("2019-12-01", "2030-01-01") == "2019-12-31"
    assert realtime.month_end("2019-12-01", "2019-12-15") == "2019-12-15"


RELEASE = {"2019-04": "2019-05-10", "2019-05": "2019-06-12"}


def _official_entry():
    return {"weight": 0.5, "live_from": None,
            "obs_dates": ["2019-04-01", "2019-05-01"],
            "own_yoy_daily": {"2019-04-01": 2.0, "2019-05-01": 3.0}}


def test_official_point_counts_only_from_its_release_date():
    e = _official_entry()
    # hindsight would read the May print (3.0) on May 31; BLS released it Jun 12
    assert realtime.component_yoy_known_on(e, "2019-05-31", 0, RELEASE) == 2.0
    assert realtime.component_yoy_known_on(e, "2019-06-11", 0, RELEASE) == 2.0
    assert realtime.component_yoy_known_on(e, "2019-06-12", 0, RELEASE) == 3.0
    assert realtime.component_yoy_known_on(e, "2019-05-09", 0, RELEASE) is None


def test_live_point_counts_after_its_publication_lag():
    e = {"weight": 0.5, "live_from": "2019-01-01",
         "obs_dates": ["2019-04-01", "2019-05-01"],
         "own_yoy_daily": {"2019-04-01": 5.0, "2019-05-01": 6.0}}
    assert realtime.component_yoy_known_on(e, "2019-05-31", 46, RELEASE) == 5.0
    assert realtime.component_yoy_known_on(e, "2019-06-16", 46, RELEASE) == 6.0
    assert realtime.component_yoy_known_on(e, "2019-05-01", 0, RELEASE) == 6.0


def test_live_component_before_its_live_start_is_official():
    e = {"weight": 1.0, "live_from": "2019-05-15",
         "obs_dates": ["2019-04-01", "2019-05-01", "2019-05-20"],
         "own_yoy_daily": {"2019-04-01": 1.0, "2019-05-01": 2.0, "2019-05-20": 9.0}}
    # 2019-05-01 is an official point (before live_from): released Jun 12
    assert realtime.component_yoy_known_on(e, "2019-05-19", 0, RELEASE) == 1.0
    assert realtime.component_yoy_known_on(e, "2019-05-31", 0, RELEASE) == 9.0


def test_headline_known_on_uses_the_month_ends_weights():
    live = {"weight": 0.5, "live_from": "2019-01-01", "obs_dates": ["2019-05-30"],
            "own_yoy_daily": {"2019-05-30": 4.0}}
    v = {"as_of": "2019-06-30",
         "components": {"off": _official_entry(), "live": live},
         "weights_by_month": {"2018-05": {"off": 0.25, "live": 0.75}}}
    # May 31: official April (2.0), live May 30 (4.0), May-2018 weights
    assert realtime.headline_known_on(v, "2019-05-31", {}, RELEASE) == pytest.approx(3.5)
    v.pop("weights_by_month")  # fixed-weight fallback
    assert realtime.headline_known_on(v, "2019-05-31", {}, RELEASE) == pytest.approx(3.0)


def test_ledger_reading_wins_within_a_week_of_month_end():
    rows = [{"date": "2019-05-20", "gauge_yoy_pct": 1.1},
            {"date": "2019-05-29", "gauge_yoy_pct": 2.2},
            {"date": "2019-06-02", "gauge_yoy_pct": 9.9}]
    assert realtime.ledger_reading(rows, "2019-05-31") == 2.2
    assert realtime.ledger_reading(rows, "2019-04-30") is None
    v = {"as_of": "2019-06-30", "components": {"off": _official_entry()}}
    tr = realtime.track(v, ["2019-04-01", "2019-05-01"], {}, RELEASE, rows)
    assert tr["dates"] == ["2019-04-30", "2019-05-31"]
    assert tr["source"] == ["reconstructed", "ledger"]
    assert tr["gauge_yoy_pct"] == [None, 2.2]  # April print not out by Apr 30


# --- compare.json wiring ------------------------------------------------------

CPI = [("2018-01-01", 100.0, "2018-02-14"), ("2018-02-01", 100.5, "2018-03-13"),
       ("2018-03-01", 101.0, "2018-04-11"), ("2018-04-01", 101.4, "2018-05-10"),
       ("2019-01-01", 102.0, "2019-02-13"), ("2019-02-01", 103.0, "2019-03-12"),
       ("2019-03-01", 104.5, "2019-04-10"), ("2019-04-01", 105.0, "2019-05-10")]


def _conn(tmp_path):
    obs = [Observation(series_code="CPIAUCNS", obs_date=d, value=v, vintage_date=vd,
                       source="FRED", route="ALFRED") for d, v, vd in CPI]
    vintage.append_vintages(obs, tmp_path)
    return vintage.load(tmp_path)


def _result():
    dates = [f"2019-{m:02d}-{d:02d}" for m in (1, 2, 3, 4) for d in (1, 15, 28)]
    off_yoy = {"2019-01-01": 2.0, "2019-02-01": 2.5, "2019-03-01": 3.5, "2019-04-01": 3.6}
    entry = {"weight": 1.0, "mode": "bls_cf", "live_from": None,
             "obs_dates": sorted(off_yoy),
             "own_yoy_daily": {d: off_yoy[max(k for k in off_yoy if k <= d)] for d in dates}}
    v = {"index": {d: 100.0 for d in dates},
         "yoy": dict(entry["own_yoy_daily"]), "as_of": dates[-1],
         "coverage_pct": 0.0, "gate_flags": [], "components": {"x": entry},
         "weights_by_month": None}
    return {"base_month": "2018-01", "basket": [],
            "variants": {n: v for n in ("gauge", "col", "tracker", "supercore", "pce")}}


def test_compare_publishes_realtime_track_and_validates(tmp_path):
    conn = _conn(tmp_path)
    p = compare.build(_result(), conn, ledger_rows=[])
    rt = p["realtime"]
    assert rt["months"] == p["months"] == ["2019-01-01", "2019-02-01", "2019-03-01",
                                           "2019-04-01"]
    assert rt["dates"] == ["2019-01-31", "2019-02-28", "2019-03-31", "2019-04-28"]
    # hindsight reads month m's print at m's end; real time the prior print
    assert p["gauge_yoy_pct"] == [2.0, 2.5, 3.5, 3.6]
    assert rt["gauge_yoy_pct"] == [None, 2.0, 2.5, 3.5]
    assert rt["source"] == ["reconstructed"] * 4 and rt["n_ledger"] == 0
    assert rt["validation"]["window"] == "2019-01..2019-04"
    assert rt["validation"]["lead_lag"]["best_shift_months"] == 1
    assert "first release" in rt["basis"]
    path = compare.write(p, tmp_path, published_at="2019-05-01T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "compare.schema.json")


def test_compare_ledger_rows_replace_reconstruction(tmp_path):
    conn = _conn(tmp_path)
    p = compare.build(_result(), conn,
                      ledger_rows=[{"date": "2019-04-26", "gauge_yoy_pct": 3.33}])
    assert p["realtime"]["gauge_yoy_pct"][-1] == 3.33
    assert p["realtime"]["source"][-1] == "ledger"
    assert p["realtime"]["n_ledger"] == 1


def test_compare_without_component_obs_dates_omits_realtime(tmp_path):
    r = _result()
    for v in r["variants"].values():
        v["components"] = {}
    assert "realtime" not in compare.build(r, _conn(tmp_path))


def test_gauge_entries_carry_obs_dates_and_live_start(tmp_path):
    from pipeline.engine import gauge
    from tests.test_gauge import ROWS, STALENESS, seed
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g, t = r["variants"]["gauge"]["components"], r["variants"]["tracker"]["components"]
    assert g["shelter"]["live_from"] == "2018-01-01"      # live throughout
    assert g["shelter"]["obs_dates"] == ["2018-01-01", "2019-01-01"]
    assert t["shelter"]["live_from"] is None               # bls_cf in tracker
