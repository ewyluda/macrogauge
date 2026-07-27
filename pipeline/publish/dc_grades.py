"""Writer for dc_grades.json -- the /dc-scoreboard grading harness.

Grades the three LIVE-COMPUTABLE escalation bases against realized DC Build
escalation, on two labelled legs, plus the P3c lead-lag study and the power
nowcast's published negative result.

The two hindsight-selected regimes publish their rates and windows and NO
grading statistic. Neither leg may be rendered without the other: the strict
leg's long_run shortfall rates at 36/48 months (96.9%/100% measured
2026-07-26 -- unpublished, the strict leg withholds those horizons as too
thin) fall to 64.2%/64.7% once the extended leg puts a downturn back in the
sample, and that spread is itself the finding (spec 3.1). The artifact is
authoritative for the current figures; numbers here are dated context.

The lead-lag study's `caveats`/`conclusion` fields carry the same discipline:
a "1 of 4 mappings stable" result must never be rendered without them (spec
6.1) -- see engine/dcleadlag.py for why.

ALL derived math lives in engine/dcgrade.py, engine/dcleadlag.py and
engine/powergrade.py; the site renders only."""
from pathlib import Path

from pipeline.engine import dcgrade, dcleadlag, powergrade
from pipeline.publish.util import write_json

# Hand-set to the observed episodes, stated on-page with their bounds. They
# are not derived by a rule and this module does not pretend otherwise.
SCENARIOS = [
    {"key": "gfc", "label": "GFC downturn",
     "start_month": "2008-12-01", "end_month": "2011-12-01"},
    {"key": "covid_peak", "label": "COVID peak",
     "start_month": "2021-04-01", "end_month": "2023-12-01"},
]

def paired_legs_note(revision_disclosure_pp: float | None) -> str:
    """Built from the measured bound the artifact itself publishes, never a
    fixed literal: the note used to hardcode "0.27pp" as prose, and the first
    fully backfilled artifact's own anchor rows exceeded that figure 2.5x
    over while the sentence beside them still claimed it as the maximum --
    the same claim-outlives-the-number failure powergrade.note() exists to
    prevent."""
    distortion = ("at a distortion unmeasured this publish (no overlapping "
                  "vintage-true anchor to compare against)"
                  if revision_disclosure_pp is None else
                  f"at a measured {revision_disclosure_pp}pp maximum "
                  "distortion")
    return ("Two legs, always shown together. The strict leg is vintage-true "
            "but its anchors begin 2018-01 and contain the 2021-22 spike "
            "with no downturn; the extended leg reaches back to 2010-12 on "
            f"final-revision data, {distortion}. Quoting either leg alone "
            "overstates how much the answer is known.")


def build(conn, components) -> dict:
    """The one artifact the /dc-scoreboard page reads: both grading legs,
    the ungraded scenario windows, the lead-lag study (with its required
    caveats/conclusion), and the power-nowcast negative result."""
    payload = dcgrade.build(conn, components, dcgrade.BASE_MONTH, SCENARIOS)
    payload["paired_legs_note"] = paired_legs_note(
        payload["revision_disclosure_pp"])
    payload["leadlag"] = dcleadlag.study(conn, components)
    payload["power_nowcast"] = powergrade.run(conn)
    return payload


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "dc_grades.json")
