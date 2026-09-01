import type { Metadata } from "next";
import dcJson from "../../../public/data/datacenter.json";
import gradesJson from "../../../public/data/dc_grades.json";
import { KpiCard } from "@/components/KpiCard";
import {
  GradesClient,
  type ReconstructionNote,
} from "@/components/grades/GradesClient";
import { BASES, bases, lastCompleteMonth } from "@/lib/dcContingency";
import { BASIS_LABELS, ESCALATION_BASIS_TO_GRADE } from "@/lib/dcGrades";
import type { DcGrades } from "@/lib/types";

const data = gradesJson as unknown as DcGrades;
const strict = data.legs?.strict;
const extended = data.legs?.extended;
const ruleCount = Object.keys(BASIS_LABELS).length;

/** How far the PPI-only reconstruction graded here sits from the index the
 *  site actually displays — measured live, on the server, from the two
 *  published artifacts rather than asserted.
 *
 *  dcgrade.load_component_versions reads each component's official series and
 *  nothing else, so the graded index carries no live futures tail. The
 *  published index splices one onto the copper/aluminium components past
 *  their last official print. The two therefore agree everywhere the splice
 *  is inactive and diverge in the splice month — which happens to be the
 *  anchor every basis is read at. Rather than restate a measured constant
 *  that would go stale as futures move, this reads both numbers out of the
 *  artifacts on every build: the graded side from `anchors` (the extended
 *  leg's row at the shared anchor month), the published side from
 *  dcContingency's `bases()` over datacenter.json's monthly grid — the same
 *  function /escalation itself uses, so the "displayed" figure quoted really
 *  is the figure displayed. */
function measureReconstruction(): ReconstructionNote | null {
  const build = dcJson.indexes.build;
  const comps = build.components;
  const proxies = comps.filter((c) => c.mode !== "official");
  const month = lastCompleteMonth(
    build.monthly.months,
    comps.map((c) => c.last_obs),
  );
  if (!month) return null;
  const graded = data.anchors.find((a) => a.leg === "extended" && a.m === month);
  if (!graded) return null;

  const published = bases(build.monthly.months, build.monthly.index, month);
  let worst: ReconstructionNote["worst"] = null;
  for (const row of published) {
    const key = ESCALATION_BASIS_TO_GRADE[row.key];
    const g = key ? graded.bases[key] : null;
    if (key == null || g == null) continue;
    if (!worst || Math.abs(g - row.annualizedPct) > Math.abs(worst.graded - worst.published)) {
      worst = { basis: key, graded: g, published: row.annualizedPct };
    }
  }
  return {
    month,
    proxyLabels: proxies.map((c) => c.label),
    proxyWeightPct: proxies.reduce((a, c) => a + c.weight, 0) * 100,
    worst,
  };
}

const reconstruction = measureReconstruction();

export const metadata: Metadata = {
  title: "DC Escalation Scoreboard: did each contingency basis carry enough?",
  description:
    "Every escalation basis on /escalation, graded against what DC build costs actually did — vintage-true, on two labelled samples.",
};

export default function Page() {
  return (
    <div>
      <h1>
        DC Escalation Scoreboard{" "}
        <span className="subtitle">did the basis you carried hold?</span>
      </h1>
      <p className="lede">
        <b>
          /escalation offers {BASES.length} bases to carry as a contingency
          factor. This grades the {ruleCount} that are rules
        </b>{" "}
        — {Object.values(BASIS_LABELS).join(", ")} — against what data-center
        construction escalation actually did. For every month we can
        reconstruct what the DC Build index actually read at the time, we
        compute what each basis would have told a reader to carry, and check
        it against what escalation actually did next. The metric is the one a
        capital program is judged on — did you carry enough — not the one a
        forecaster reaches for. The two hand-picked historical regimes
        /escalation also offers (the GFC downturn, the COVID peak) are shown
        further down, unscored: they were selected with hindsight, which
        makes them ungradeable by construction.
      </p>
      <div className="kpi-row">
        <KpiCard
          label="Strict sample"
          value={strict ? `${strict.anchors_n} anchors` : "—"}
          context={
            strict
              ? `${strict.span[0]} – ${strict.span[1]} · vintage-true, no downturn`
              : "unavailable this publish"
          }
          accent="sky"
        />
        <KpiCard
          label="Extended sample"
          value={extended ? `${extended.anchors_n} anchors` : "—"}
          context={
            extended
              ? `${extended.span[0]} – ${extended.span[1]} · final-revision, includes a downturn`
              : "unavailable this publish"
          }
          accent="violet"
        />
        <KpiCard
          label="Power nowcast"
          value={data.power_nowcast?.verdict ?? "—"}
          context={
            data.power_nowcast
              ? `vs. carry-forward · as of ${data.power_nowcast.as_of ?? "—"}`
              : "unavailable this publish"
          }
          accent={
            data.power_nowcast?.verdict === "PASS"
              ? "emerald"
              : data.power_nowcast?.verdict === "FAIL"
                ? "red"
                : "amber"
          }
        />
        <KpiCard
          label="Lead-lag mappings tested"
          value={data.leadlag ? `${data.leadlag.mappings.length}` : "—"}
          context="see caveats before treating any as forecasting evidence"
          accent="amber"
        />
      </div>
      <GradesClient
        data={data}
        reconstruction={reconstruction}
        anchorsN={data.anchors.length}
      />
    </div>
  );
}
