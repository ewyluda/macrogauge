"""Backlog #4 (2026-09-28): time-varying headline weights through history.

The headline Σ w·yoy at grid date d uses BLS relative importance price-updated
to d's OWN YoY base month (aggregate.base_month(d) = month of d - 365 days),
not one month's weights applied to all of history. replay.json publishes the
per-month weights so the site's contribution math keeps exact parity."""
import tempfile
from pathlib import Path

import pytest

from pipeline import basket as basket_mod
from pipeline import derived
from pipeline.engine import aggregate, gauge
from pipeline.models import Observation
from pipeline.publish import gaptable, quilt, replay
from pipeline.store import vintage


# --- aggregate --------------------------------------------------------------

def test_base_month_is_365_days_back_including_leap_edge():
    assert aggregate.base_month("2019-08-31") == "2018-08"
    assert aggregate.base_month("2019-08-01") == "2018-08"
    # 365 days before a leap-year Feb 29 is Mar 1 of the prior year -- the
    # same base the 365-day YoY itself uses
    assert aggregate.base_month("2024-02-29") == "2023-03"
    assert aggregate.base_month("2021-03-01") == "2020-03"


def test_weighted_yoy_uses_each_dates_base_month_weights():
    yoys = {"a": {"2019-01-15": 1.0, "2019-02-15": 1.0},
            "b": {"2019-01-15": 3.0, "2019-02-15": 3.0}}
    wbm = {"2018-01": {"a": 0.5, "b": 0.5}, "2018-02": {"a": 0.25, "b": 0.75}}
    out = aggregate.weighted_yoy(yoys, {"a": 0.9, "b": 0.1}, wbm)
    assert out["2019-01-15"] == pytest.approx(2.0)   # 0.5*1 + 0.5*3
    assert out["2019-02-15"] == pytest.approx(2.5)   # 0.25*1 + 0.75*3


def test_weighted_yoy_month_without_entry_falls_back_to_fixed_weights():
    yoys = {"a": {"2019-03-15": 1.0}, "b": {"2019-03-15": 3.0}}
    out = aggregate.weighted_yoy(yoys, {"a": 0.9, "b": 0.1},
                                 {"2018-01": {"a": 0.5, "b": 0.5}})
    assert out["2019-03-15"] == pytest.approx(1.2)


def test_weighted_yoy_renormalizes_per_date_over_a_subset():
    # supercore: a slice of the full basket's per-month weights
    yoys = {"a": {"2019-01-15": 1.0, "2019-02-15": 1.0},
            "b": {"2019-01-15": 3.0, "2019-02-15": 3.0}}
    wbm = {"2018-01": {"a": 0.1, "b": 0.1}, "2018-02": {"a": 0.1, "b": 0.3}}
    out = aggregate.weighted_yoy(yoys, {"a": 0.2, "b": 0.2}, wbm)
    assert out["2019-01-15"] == pytest.approx(2.0)
    assert out["2019-02-15"] == pytest.approx(2.5)


def test_weighted_yoy_without_weights_by_month_is_unchanged():
    yoys = {"a": {"d": 1.0}, "b": {"d": 3.0}}
    assert aggregate.weighted_yoy(yoys, {"a": 0.5, "b": 0.5}) == \
        aggregate.weighted_yoy(yoys, {"a": 0.5, "b": 0.5}, None)


# --- weights_through_history fallbacks ---------------------------------------

class _C:
    def __init__(self, code):
        self.code = code


def test_missing_month_carries_same_year_then_falls_back_to_config(monkeypatch):
    raw = {"2025-08": {"a": 0.3, "b": 0.7}, "2025-09": {"a": 0.4, "b": 0.6},
           "2025-10": None,  # the never-published print
           "2025-11": {"a": 0.45, "b": 0.55},
           "2026-01": None}  # no earlier month in the 2026 weight year
    monkeypatch.setattr(derived, "effective_weights_by_month",
                        lambda conn, comps, months: {m: raw.get(m) for m in months})
    out = gauge.weights_through_history(None, [_C("a"), _C("b")], "2025-08",
                                        "2026-01", {"a": 0.9, "b": 0.1})
    assert out["2025-10"] == {"a": 0.4, "b": 0.6}      # carried from 2025-09
    assert out["2025-12"] == {"a": 0.45, "b": 0.55}    # carried from 2025-11
    assert out["2026-01"] == {"a": 0.9, "b": 0.1}      # config December weights


def test_rounded_weights_sum_to_exactly_one(monkeypatch):
    monkeypatch.setattr(derived, "effective_weights_by_month",
                        lambda conn, comps, months: {m: {"a": 1 / 3, "b": 1 / 3, "c": 1 / 3}
                                                     for m in months})
    out = gauge.weights_through_history(None, [_C("a"), _C("b"), _C("c")],
                                        "2025-01", "2025-02", {})
    for w in out.values():
        assert sum(w.values()) == pytest.approx(1.0, abs=1e-12)
        assert all(round(v, 6) == v for v in w.values())


# --- end to end on the real 14-component basket -----------------------------

def _months(first_year=2016, last=(2019, 9)):
    out, y, m = [], first_year, 12
    while (y, m) <= last:
        out.append(f"{y}-{m:02d}-01")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


@pytest.fixture(scope="module")
def real_basket_run():
    """Real basket with CPIAUCNS + all 13 named official series, Dec 2016 ->
    Sep 2019, each component at its own monthly growth rate so relative
    prices -- and therefore the price-updated weights -- move every month.
    "other" rides the derived CPI residual, exactly as in production."""
    _, comps = basket_mod.load_basket()
    months = _months()
    obs = []
    for i, comp in enumerate(comps):
        if comp.official_series == derived.RESIDUAL_CODE:
            continue
        g = 0.001 + 0.0006 * i  # 0.1%..0.9%/mo, distinct per component
        obs += [Observation(series_code=comp.official_series, obs_date=d,
                            value=100.0 * (1 + g) ** j, vintage_date="2019-10-15",
                            source="T", route="API")
                for j, d in enumerate(months)]
    obs += [Observation(series_code="CPIAUCNS", obs_date=d,
                        value=240.0 * 1.003 ** j, vintage_date="2019-10-15",
                        source="T", route="API")
            for j, d in enumerate(months)]
    with tempfile.TemporaryDirectory() as td:
        vintage.append(obs, Path(td))
        conn = vintage.load(Path(td))
    result = gauge.run(conn, today="2019-10-01")
    return conn, result


def test_weights_vary_by_month_and_equal_price_updated_ri(real_basket_run):
    conn, result = real_basket_run
    wbm = result["variants"]["gauge"]["weights_by_month"]
    comps = result["basket"]
    assert wbm["2018-01"] != wbm["2018-09"]  # really time-varying
    for m in ("2017-03", "2018-06", "2018-09"):
        eff = derived.effective_weights(conn, comps, m)
        for c in comps:
            assert wbm[m][c.code] == pytest.approx(eff[c.code], abs=2e-6), (m, c.code)
        assert sum(wbm[m].values()) == pytest.approx(1.0, abs=1e-12)


@pytest.mark.parametrize("variant", ["gauge", "col", "tracker"])
def test_headline_is_per_date_weighted_sum(real_basket_run, variant):
    _, result = real_basket_run
    v = result["variants"][variant]
    wbm = v["weights_by_month"]
    checked = 0
    for d, y in v["yoy"].items():
        if y is None:
            continue
        w = wbm[aggregate.base_month(d)]
        manual = sum(w[k] * e["own_yoy_daily"][d] for k, e in v["components"].items())
        assert y == pytest.approx(manual, abs=1e-9), d
        checked += 1
    assert checked > 300


def test_per_date_weights_differ_from_fixed_weights_in_history(real_basket_run):
    _, result = real_basket_run
    v = result["variants"]["gauge"]
    d = "2018-06-30"
    fixed = sum(e["weight"] * e["own_yoy_daily"][d] for e in v["components"].values())
    assert abs(v["yoy"][d] - fixed) > 1e-4


def test_supercore_renormalizes_its_subset_per_date(real_basket_run):
    _, result = real_basket_run
    sc = result["variants"]["supercore"]
    full = result["variants"]["gauge"]["weights_by_month"]
    for d in ("2018-03-31", "2019-06-30"):
        w = full[aggregate.base_month(d)]
        num = sum(w[k] * e["own_yoy_daily"][d] for k, e in sc["components"].items())
        den = sum(w[k] for k in sc["components"])
        assert sc["yoy"][d] == pytest.approx(num / den, abs=1e-9)


def test_pce_keeps_fixed_bea_weights(real_basket_run):
    _, result = real_basket_run
    pce = result["variants"]["pce"]
    assert pce["weights_by_month"] is None
    d = "2019-06-30"
    total = sum(e["weight"] for e in pce["components"].values())
    manual = sum(e["weight"] * e["own_yoy_daily"][d]
                 for e in pce["components"].values()) / total
    assert pce["yoy"][d] == pytest.approx(manual, abs=1e-9)


def test_replay_weights_reproduce_headline_at_every_published_date(real_basket_run):
    """The site parity contract: Σ published weights_by_month[base month] x
    published (2dp) component YoY == the published headline YoY, every date."""
    _, result = real_basket_run
    comps = result["basket"]
    p = replay.build(result, comps)
    g = result["variants"]["gauge"]
    checked = 0
    for i, d in enumerate(p["dates"]):
        if g["yoy"].get(d) is None:
            continue
        bm = aggregate.base_month(d)
        s = sum(c["weights_by_month"][bm] * c["yoy"][i] for c in p["components"])
        assert s == pytest.approx(g["yoy"][d], abs=0.006), d  # 2dp-rounded inputs
        checked += 1
    assert checked > 300
    months = set(p["components"][0]["weights_by_month"])
    assert months == {aggregate.base_month(d) for d in p["dates"]}


def test_quilt_and_gaptable_use_the_dates_weights(real_basket_run):
    conn, result = real_basket_run
    comps = result["basket"]
    g = result["variants"]["gauge"]
    wbm = g["weights_by_month"]
    q = quilt.build(result, comps)
    k = q["months"].index("2018-06")
    for c in q["components"]:
        assert c["weights"][k] == wbm["2017-06"][c["code"]]
    gt = gaptable.build(result, conn, comps, "2019-09-01")
    end_w = wbm[aggregate.base_month(g["as_of"])]
    for row in gt["rows"]:
        assert row["weight"] == end_w[row["component"]]
