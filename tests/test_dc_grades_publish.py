"""Publisher tests for dc_grades.json -- the /dc-scoreboard grading harness.

CORRECTION from the original brief: its `payload` fixture called
`vintage.load(REPO / "store")`, the live committed store. This repo permits
exactly ONE live-data test in the whole suite -- test_dcgrade.py's
`test_reconstruction_matches_the_published_build_index` -- and it already
exists. Every test here instead builds a synthetic store under tmp_path,
reusing test_dcgrade.py's own synthetic-Build-store helper
(`DC_BUILD_SERIES` / `_write_synthetic_dc_store`) rather than inventing a
second one (cross-module test imports are established precedent in this repo
-- see tests/test_run_daily.py's `from tests.test_fred import FakeResponse`
and tests/test_geo_writer.py's `from tests.test_registry import
STATE_ABBREVS`), and layers a small amount of unfilled-orders and
power-nowcast history on top so all three engines `dc_grades.build()` wires
together (dcgrade, dcleadlag, powergrade) have something real to grade
instead of every sub-payload degrading to null. A payload where everything
downstream of dcgrade is null would still validate against the schema, but
it would not exercise the publisher's actual wiring -- reading real config
(dc_basket.load_baskets, the registry) is fine; reading committed store
*data* is what Correction 1 forbids.
"""
import json
import math
from datetime import date, timedelta
from pathlib import Path

import jsonschema
import pytest

from pipeline import dc_basket, registry
from pipeline.dates import months_back
from pipeline.engine import powergrade
from pipeline.models import Observation
from pipeline.publish import dc_grades, validate
from pipeline.store import vintage

from tests.test_dcgrade import _write_synthetic_dc_store

REPO = Path(__file__).parent.parent
SCHEMA = REPO / "schemas" / "dc_grades.schema.json"


def _write_leadlag_and_power_history(store_dir) -> None:
    """Small synthetic history for the 3 unfilled-orders drivers (dcleadlag)
    and the power-nowcast retail/hub series (powergrade), layered onto the
    same synthetic store dir as the DC Build fixture.

    Values are arbitrary -- these tests check structure and presence, not
    specific figures (those are pinned directly in test_dcleadlag.py and
    test_powergrade.py, which is where a regression in either engine's own
    math would actually be caught).
    """
    obs = []
    # ~16.5yr monthly: clears dcleadlag.MIN_OVERLAP (36) twice over in each
    # split half, so the lead-lag study has enough overlap to compute a real
    # (not None) correlation profile rather than degrading silently.
    for i in range(200):
        m = months_back("2010-01-01", -i)
        val = 100 + 8 * math.sin(i / 6.0)
        for code in ("fred_uo_electrical", "fred_uo_hvac", "fred_uo_turbines"):
            obs.append(Observation(series_code=code, obs_date=m, value=val,
                                   vintage_date=m, source="test",
                                   route="synthetic"))
    # Power retail + hub history, shaped like test_powergrade.py's own
    # "_store_where_nowcast_loses" fixture so grade_all() has a real
    # common-month intersection to score (>0 months_graded, non-null MAE).
    for i in range(40):
        m = months_back("2023-01-01", -i)
        obs.append(Observation(series_code=powergrade.RETAIL, obs_date=m,
                               value=8.0 + i * 0.02, vintage_date=m,
                               source="test", route="synthetic"))
    for hub in powergrade.HUBS:
        start = date(2023, 1, 1)
        for i in range(1200):
            d = (start + timedelta(days=i)).isoformat()
            val = 30.0 + 25.0 * ((i // 30) % 2)   # violent wholesale swings
            obs.append(Observation(series_code=hub, obs_date=d, value=val,
                                   vintage_date=d, source="test",
                                   route="synthetic"))
    vintage.append_vintages(obs, store_dir)


@pytest.fixture(scope="module")
def payload(tmp_path_factory):
    store_dir = tmp_path_factory.mktemp("dc_grades_store")
    _write_synthetic_dc_store(store_dir)
    _write_leadlag_and_power_history(store_dir)
    conn = vintage.load(store_dir)
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    return dc_grades.build(conn, baskets["build"])


def test_payload_validates_against_the_schema(payload, tmp_path):
    p = dc_grades.write(payload, tmp_path, published_at="2026-07-26T00:00:00Z")
    validate.validate_file(p, SCHEMA)


def test_schema_accepts_a_fully_degraded_payload():
    """A grades_ok:false run must still validate (global constraint)."""
    degraded = {"published_at": "2026-07-26T00:00:00Z", "as_of": None,
                "legs": {}, "anchors": [], "scenarios": [],
                "revision_disclosure_pp": 0.27,
                "leadlag": None, "power_nowcast": None}
    jsonschema.validate(degraded, json.loads(SCHEMA.read_text()))


def test_payload_carries_both_legs_and_the_revision_disclosure(payload):
    assert set(payload["legs"]) == {"strict", "extended"}
    assert payload["revision_disclosure_pp"] == 0.27


def test_payload_strict_leg_publishes_only_h12_and_h24(payload):
    """Correction 3: the strict leg's independent draws at h=36/h=48 are
    ~1.78/~1.08 on the real sample -- roughly one draw -- so it must publish
    only h=12 and h=24 (dcgrade.STRICT_HORIZONS), while the extended leg
    still carries all four. The schema must accept legs with DIFFERENT
    horizon key sets -- this pins that the publisher's actual output needs
    that flexibility, not just that the schema happens to allow it."""
    strict, extended = payload["legs"]["strict"], payload["legs"]["extended"]
    assert strict["published_horizons"] == [12, 24]
    assert set(extended["published_horizons"]) == {12, 24, 36, 48}
    for basis_grades in strict["grades"].values():
        assert set(basis_grades) <= {"h12", "h24"}


def test_payload_scenarios_carry_no_grading_statistic(payload):
    banned = {"shortfall_rate_pct", "mae_pp", "bias_pp", "n",
              "mean_shortfall_pp", "worst_shortfall_pp", "independent_draws"}
    assert payload["scenarios"], "fixture produced no scenarios -- assertion below is vacuous"
    for s in payload["scenarios"]:
        assert not (banned & set(s))


def test_payload_carries_the_power_nowcast_grade_with_an_as_of(payload):
    pn = payload["power_nowcast"]
    assert pn["as_of"]
    assert pn["verdict"] in {"PASS", "FAIL", "INSUFFICIENT"}
    assert pn["carry_forward_mae"] is not None


def test_payload_carries_the_leadlag_study_and_its_gate(payload):
    ll = payload["leadlag"]
    assert ll["gate"]
    assert ll["verdict"]
    assert ll["weight_covered"] == pytest.approx(0.45)


def test_payload_leadlag_caveats_and_conclusion_are_structured(payload):
    """Correction 2: a "N of M mappings stable" result must not publish
    bare. `caveats` is structured {key, text} data -- not prose a consumer
    has to parse -- and `conclusion` is the standing finding that no forward
    model is warranted on this evidence, published regardless of whether
    this particular fixture's gate happens to pass or fail."""
    ll = payload["leadlag"]
    assert isinstance(ll["caveats"], list)
    for c in ll["caveats"]:
        assert set(c) == {"key", "text"}
        assert c["text"]
    assert ll["conclusion"] == "No forward model is warranted on this evidence."
    # If anything cleared the gate on this fixture, the two spec-6.1 caveats
    # must be among the ones published -- a positive result silently missing
    # its caveats is exactly what Correction 2 exists to prevent.
    if ll["weight_stable"] > 0:
        assert {"contemporaneous_not_lead", "split_artifact"} & \
            {c["key"] for c in ll["caveats"]}
