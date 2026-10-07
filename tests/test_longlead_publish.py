import json
from pathlib import Path

import jsonschema
import pytest

from pipeline import dc_basket, dc_longlead, registry
from pipeline.dc_basket import DCComponent
from pipeline.publish import longlead, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

COMPONENTS = [
    DCComponent(code="switchgear", label="Switchgear & switchboard",
                group="electrical", series="ppi_switchgear", weight=0.14),
    DCComponent(code="pumps", label="Industrial pumps",
                group="mechanical", series="ppi_pumps", weight=0.05),
]

DC_RESULT = {"indexes": {"build": {"components": {
    "switchgear": {"label": "Switchgear & switchboard", "group": "electrical",
                   "weight": 0.14, "mode": "official", "yoy_pct": 5.0,
                   "last_obs": "2026-05-01", "implied_level": 130.0,
                   "stale": False},
    "pumps": {"label": "Industrial pumps", "group": "mechanical",
              "weight": 0.05, "mode": "official", "yoy_pct": None,
              "last_obs": "2026-05-01", "implied_level": 118.0,
              "stale": False},
}}}}


def _fig(kind="backlog", unit="usd_b", value=176.0, asof="2026-07-01"):
    return dc_longlead.Figure(
        metric="Backlog", kind=kind, basis="rpo", scope="group",
        value=value, unit=unit, period="2026-06-30", asof=asof,
        quote="With a backlog of $176 billion...",
        src_label="Q2 2026 8-K", src_url="https://example.test/8k")


def _cfg(figures=None, cadence="quarterly", null_vendor=False, teaser=()):
    vendor = dc_longlead.Vendor(
        key="gev", name="GE Vernova", ticker="GEV", listed="NYSE",
        dc_segment="Electrification", cadence=cadence,
        figures=() if null_vendor else tuple(figures or [_fig()]),
        null_note="No disclosure at standard." if null_vendor else None)
    return dc_longlead.LongLeadConfig(
        as_of_curated="2026-07-27",
        packages=(dc_longlead.Package(code="switchgear", vendor_keys=("gev",),
                                      null_note=None),
                  dc_longlead.Package(code="pumps", vendor_keys=(),
                                      null_note="No roster vendor.")),
        vendors={"gev": vendor},
        teaser=tuple(teaser))


def test_build_joins_price_legs():
    out = longlead.build(_cfg(), COMPONENTS, DC_RESULT, today="2026-07-27")
    sw = out["packages"][0]
    assert (sw["code"], sw["label"], sw["weight"]) == (
        "switchgear", "Switchgear & switchboard", 0.14)
    assert sw["price_yoy_pct"] == 5.0
    assert sw["price_last_obs"] == "2026-05-01"
    assert sw["contribution_pp"] == 0.7          # 0.14 x 5.0, publisher rule
    pumps = out["packages"][1]
    assert pumps["contribution_pp"] is None      # yoy None -> unknowable
    assert pumps["vendors"] == [] and pumps["null_note"] == "No roster vendor."
    assert out["build_weight_covered"] == pytest.approx(0.19)  # 0.14 + 0.05
    fig = sw["vendors"][0]["figures"][0]
    assert fig["src"] == {"label": "Q2 2026 8-K", "url": "https://example.test/8k"}
    assert fig["quote"] == "With a backlog of $176 billion..."


def test_price_yoy_pct_rounds_2dp_but_contribution_uses_unrounded_yoy():
    # publish/datacenter.py rounds yoy_pct to 2dp for display but computes
    # contribution_pp from the UNROUNDED engine value -- longlead.py must
    # mirror that exactly so the two artifacts can never disagree on the same
    # series (review recommendation). 5.035 is chosen because it's a case
    # where round(w*yoy,2) genuinely differs from round(w*round(yoy,2),2) --
    # a weaker test could pass by accident on a value where they coincide.
    dc_result = {"indexes": {"build": {"components": {
        "switchgear": {**DC_RESULT["indexes"]["build"]["components"]["switchgear"],
                       "yoy_pct": 5.035},
        "pumps": DC_RESULT["indexes"]["build"]["components"]["pumps"],
    }}}}
    out = longlead.build(_cfg(), COMPONENTS, dc_result, today="2026-07-27")
    sw = out["packages"][0]
    assert sw["price_yoy_pct"] == 5.04                    # round(5.035, 2)
    assert sw["contribution_pp"] == 0.7                   # round(0.14 * 5.035, 2)
    assert sw["contribution_pp"] != round(0.14 * 5.04, 2)  # not derived from the rounded field


def test_build_degrades_without_dc_result():
    out = longlead.build(_cfg(), COMPONENTS, None, today="2026-07-27")
    sw = out["packages"][0]
    assert sw["weight"] == 0.14                  # basket weight survives
    assert sw["price_yoy_pct"] is None
    assert sw["price_last_obs"] is None
    assert sw["contribution_pp"] is None
    assert sw["vendors"][0]["figures"]           # vendor rows never blank


def test_stale_flag_boundary_quarterly():
    # asof 2026-07-01, allowance 120d: 2026-10-29 is day 120 (fresh),
    # 2026-10-30 is day 121 (stale)
    fresh = longlead.build(_cfg(), COMPONENTS, None, today="2026-10-29")
    stale = longlead.build(_cfg(), COMPONENTS, None, today="2026-10-30")
    assert fresh["packages"][0]["vendors"][0]["stale"] is False
    assert stale["packages"][0]["vendors"][0]["stale"] is True


def test_stale_flag_boundary_annual():
    # allowance 430d from 2026-07-01: 2027-09-04 fresh, 2027-09-05 stale
    fresh = longlead.build(_cfg(cadence="annual"), COMPONENTS, None,
                           today="2027-09-04")
    stale = longlead.build(_cfg(cadence="annual"), COMPONENTS, None,
                           today="2027-09-05")
    assert fresh["packages"][0]["vendors"][0]["stale"] is False
    assert stale["packages"][0]["vendors"][0]["stale"] is True


def test_null_note_vendor_is_never_stale():
    out = longlead.build(_cfg(null_vendor=True), COMPONENTS, None,
                         today="2030-01-01")
    vendor = out["packages"][0]["vendors"][0]
    assert vendor["stale"] is False and vendor["null_note"]


def test_teaser_stale_tracks_its_own_figure_not_the_vendor_max():
    # A refreshed sibling figure must not keep a discontinued teaser pick
    # looking fresh on the /datacenter strip: the vendor row ages on the
    # newest figure, the teaser on the figure it actually shows.
    figures = [_fig(kind="book_to_bill", unit="ratio", value=1.2,
                    asof="2026-02-11"),
               _fig(kind="backlog", asof="2026-07-01")]
    out = longlead.build(_cfg(figures=figures,
                              teaser=(("gev", "book_to_bill"),)),
                         COMPONENTS, DC_RESULT, today="2026-07-27")
    assert out["teaser"][0]["stale"] is True          # 166d > 120 on ITS asof
    vendor = out["packages"][0]["vendors"][0]
    assert vendor["stale"] is False                   # vendor max is 26d old


def test_teaser_passthrough():
    out = longlead.build(_cfg(teaser=(("gev", "backlog"),)), COMPONENTS,
                         DC_RESULT, today="2026-07-27")
    assert out["teaser"] == [{"vendor": "gev", "name": "GE Vernova", "stale": False,
                              "figure": out["packages"][0]["vendors"][0]["figures"][0]}]


def test_teaser_carries_vendor_staleness():
    # The /datacenter strip is the most prominent surface for a discontinued
    # disclosure (spec finding: Vertiv's book-to-bill went stale but the
    # strip showed the bare number) -- teaser stale must track the vendor's
    # own _stale computation, not always publish False.
    out = longlead.build(_cfg(teaser=(("gev", "backlog"),)), COMPONENTS,
                         DC_RESULT, today="2030-01-01")
    assert out["teaser"][0]["stale"] is True
    assert out["packages"][0]["vendors"][0]["stale"] is True


def test_written_file_validates_against_schema(tmp_path):
    payload = longlead.build(_cfg(teaser=(("gev", "backlog"),)), COMPONENTS,
                             DC_RESULT, today="2026-07-27")
    path = longlead.write(payload, tmp_path, published_at="2026-07-27T12:00:00Z")
    assert path.name == "longlead.json"
    validate.validate_file(path, SCHEMAS / "longlead.schema.json")
    assert json.loads(path.read_text())["published_at"] == "2026-07-27T12:00:00Z"


def test_degraded_payload_validates(tmp_path):
    # dc_result=None + empty teaser must validate without inventing values
    payload = longlead.build(_cfg(), COMPONENTS, None, today="2026-07-27")
    path = longlead.write(payload, tmp_path, published_at="2026-07-27T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "longlead.schema.json")


def test_lead_times_pass_through_stated_and_age_on_the_annual_allowance(tmp_path):
    lt = dc_longlead.LeadTime(item="Switchgear, US average", weeks=44.0, through=None,
                              basis="industry-survey", period="2025-06-30", asof="2025-10-15",
                              quote="switchgear edged down to an average of 44 weeks",
                              src_label="Wood Mackenzie", src_url="https://example.test/wm")
    base = _cfg()
    cfg = dc_longlead.LongLeadConfig(
        as_of_curated=base.as_of_curated,
        packages=(dc_longlead.Package(code="switchgear", vendor_keys=("gev",), null_note=None,
                                      lead_times=(lt,)),) + base.packages[1:],
        vendors=base.vendors, teaser=(), lead_time_benchmark=lt)
    fresh = longlead.build(cfg, COMPONENTS, DC_RESULT, today="2026-10-07")
    row = fresh["packages"][0]["lead_times"][0]
    assert row == {"item": "Switchgear, US average", "weeks": 44.0, "through": None,
                   "basis": "industry-survey", "period": "2025-06-30", "asof": "2025-10-15",
                   "stale": False, "quote": "switchgear edged down to an average of 44 weeks",
                   "src": {"label": "Wood Mackenzie", "url": "https://example.test/wm"}}
    assert fresh["packages"][1]["lead_times"] == []
    assert fresh["lead_time_benchmark"]["weeks"] == 44.0
    # more than 430 days past the source document, a survey reading flags stale
    assert longlead.build(cfg, COMPONENTS, DC_RESULT, today="2026-12-20")["packages"][0]["lead_times"][0]["stale"] is True
    path = longlead.write(fresh, tmp_path, published_at="2026-10-07T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "longlead.schema.json")


def test_real_config_publishes_and_validates(tmp_path):
    # CI gate: the committed config must publish a valid artifact even with
    # the engine down
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    cfg = dc_longlead.load(build_codes={c.code for c in baskets["build"]})
    payload = longlead.build(cfg, baskets["build"], None, today="2026-07-27")
    path = longlead.write(payload, tmp_path, published_at="2026-07-27T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "longlead.schema.json")
    assert payload["build_weight_covered"] == pytest.approx(0.50)
    assert [p["code"] for p in payload["packages"]] == [
        "switchgear", "transformers", "hvac_equip", "generators", "pumps"]


def test_backlog_months_is_sa_unfilled_over_sa_shipments_with_1y_change():
    import sqlite3
    from pipeline.publish import longlead
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, value REAL, "
                 "vintage_date TEXT, source TEXT, route TEXT)")
    rows = [("fred_uo_electrical_sa", "2025-07-01", 60000.0), ("fred_ship_electrical_sa", "2025-07-01", 10000.0),
            ("fred_uo_electrical_sa", "2026-07-01", 66000.0), ("fred_ship_electrical_sa", "2026-07-01", 12000.0),
            ("fred_uo_turbines_sa", "2026-07-01", 7000.0)]  # no turbine shipments -> group omitted
    conn.executemany("INSERT INTO observations VALUES (?, ?, ?, '2026-09-01', 'FRED', 'API')", rows)
    b = longlead.backlog_months(conn)
    assert set(b) == {"electrical"}
    assert b["electrical"]["ratio"] == [6.0, 5.5]
    assert (b["electrical"]["latest"], b["electrical"]["latest_month"], b["electrical"]["change_1y"]) == (5.5, "2026-07", -0.5)
    # the ratio fell because shipments grew faster (+20%) than the order book (+10%)
    assert (b["electrical"]["unfilled_yoy_pct"], b["electrical"]["shipments_yoy_pct"]) == (10.0, 20.0)


def test_backlog_months_survives_a_zero_year_ago_unfilled_balance():
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, value REAL, "
                 "vintage_date TEXT, source TEXT, route TEXT)")
    rows = [("fred_uo_electrical_sa", "2025-07-01", 0.0), ("fred_ship_electrical_sa", "2025-07-01", 100.0),
            ("fred_uo_electrical_sa", "2026-07-01", 600.0), ("fred_ship_electrical_sa", "2026-07-01", 100.0)]
    conn.executemany("INSERT INTO observations VALUES (?, ?, ?, '2026-09-01', 'FRED', 'API')", rows)
    e = longlead.backlog_months(conn)["electrical"]
    # the ratio series and its change stand; only the undefined leg is omitted
    assert (e["ratio"], e["change_1y"]) == ([0.0, 6.0], 6.0)
    assert "unfilled_yoy_pct" not in e and e["shipments_yoy_pct"] == 0.0
    assert longlead.PACKAGE_BACKLOG == {"switchgear": "electrical", "transformers": "electrical",
                                        "generators": "turbines"}
