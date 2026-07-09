from pathlib import Path

from pipeline import basket, registry
from pipeline.models import Observation
from pipeline.publish import methodology, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"

SOURCES = {"T": registry.Source(name="T", route="API", cadence="monthly",
                                secret=None, secret_optional=False)}
SERIES = [registry.Series(code="OFF_FU", source="T", source_id="x",
                          name="Official fuel", max_staleness_days=80),
          registry.Series(code="NEVER", source="T", source_id="y",
                          name="Never seen", max_staleness_days=10)]
COMPS = [basket.Component(code="fuel", label="Gasoline", weight=1.0,
                          official_series="OFF_FU", live_blend={"L": 1.0},
                          live_variants=("gauge",)),
         basket.Component(code="shelter_owned", label="Shelter (owned)", weight=0.265,
                          official_series="CUUR0000SEHC",
                          live_blend={"zori_us": 0.50, "aptlist_us": 0.30,
                                      "redfin_us": 0.20},
                          live_variants=("gauge",))]
RESULT = {"base_month": "2018-01", "variants": {
    "gauge": {"index": {}, "yoy": {}, "as_of": "2018-06-01",
              "coverage_pct": 40.456, "gate_flags": [],
              "components": {"fuel": {"weight": 1.0, "mode": "live",
                                      "yoy_pct": 2.345, "end_value": 101.0},
                             "shelter_owned": {"weight": 0.265, "mode": "live",
                                               "yoy_pct": 3.456, "end_value": 110.0}}},
    "tracker": {"index": {}, "yoy": {}, "as_of": "2018-06-01",
                "coverage_pct": 6.5, "gate_flags": [], "components": {}}}}
VALIDATION = {"gauge": {"corr": 0.94, "mean_abs_gap_pp": 0.79,
                        "window": "2018-01..2018-06",
                        "lead_lag": {"best_shift_months": 3, "corr": 0.95}},
              "tracker": {"corr": 0.98, "mean_abs_gap_pp": 0.39,
                          "window": "2018-01..2018-06"}}
GAPTABLE = {"rows": [{"component": "fuel", "weight": 1.0, "bls_yoy_pct": 3.0}]}
CPI = {"month": "2018-05-01", "yoy_pct": 2.9876, "prev_yoy_pct": 2.9}


def seed(tmp_path):
    vintage.append([Observation(series_code="OFF_FU", obs_date="2018-05-01",
                                value=100.0, vintage_date="2018-06-01",
                                source="T", route="API"),
                    Observation(series_code="zori_us", obs_date="2018-05-01",
                                value=100.0, vintage_date="2018-06-01",
                                source="T", route="API")], tmp_path)
    return vintage.load(tmp_path)


def test_build_stats_inventory_and_reconstruction(tmp_path):
    conn = seed(tmp_path)
    p = methodology.build(RESULT, conn, SOURCES, SERIES, COMPS, VALIDATION,
                          GAPTABLE, CPI, today="2018-06-02")
    assert p["stats"] == {"series_count": 2, "obs_count": 2, "source_count": 1,
                          "tracker_corr": 0.98, "live_coverage_pct": 40.46,
                          "engine_version": "1.0", "rebase": "2018-01=100"}
    assert [s["n"] for s in p["stages"]] == [1, 2, 3, 4, 5]
    assert p["basket"] == [
        {"code": "fuel", "label": "Gasoline", "weight": 1.0,
         "mode": "live", "live_sources": ["L"], "live_active": [],
         "official_series": "OFF_FU", "yoy_pct": 2.35},
        {"code": "shelter_owned", "label": "Shelter (owned)", "weight": 0.265,
         "mode": "live", "live_sources": ["aptlist_us", "redfin_us", "zori_us"],
         "live_active": ["zori_us"],
         "official_series": "CUUR0000SEHC", "yoy_pct": 3.46},
    ]
    assert p["freshness"] == {"fresh_count": 1, "total": 2}
    never = [r for r in p["inventory"] if r["code"] == "NEVER"][0]
    assert never["fresh"] is False and never["latest_obs"] is None
    assert p["validation"]["bls_reconstruction"] == {
        "weighted_bls_yoy_pct": 3.0, "official_yoy_pct": 2.99}
    assert len(p["limitations"]) >= 3


def test_basket_rows_split_active_vs_phase_in_sources(tmp_path):
    conn = seed(tmp_path)
    payload = methodology.build(RESULT, conn, SOURCES, SERIES, COMPS, VALIDATION,
                                GAPTABLE, CPI, today="2018-06-02")
    row = next(r for r in payload["basket"] if r["code"] == "shelter_owned")
    assert set(row["live_active"]).issubset(set(row["live_sources"]))
    # the fixture store has zori rows but no aptlist/redfin rows:
    assert "zori_us" in row["live_active"]
    assert "aptlist_us" not in row["live_active"]


def test_write_validates_against_schema(tmp_path):
    conn = seed(tmp_path)
    p = methodology.build(RESULT, conn, SOURCES, SERIES, COMPS, VALIDATION,
                          GAPTABLE, CPI, today="2018-06-02")
    path = methodology.write(p, tmp_path, published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "methodology.json"
    validate.validate_file(path, SCHEMAS / "methodology.schema.json")
