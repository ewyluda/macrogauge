import Link from "next/link";
import type { Metadata } from "next";
import dc from "../../../../public/data/datacenter.json";
import gradesJson from "../../../../public/data/dc_grades.json";
import { Citation } from "@/components/Citation";
import { DownloadData } from "@/components/DownloadData";
import { KpiCard } from "@/components/KpiCard";
import { BasisRecord } from "@/components/grades/BasisRecord";
import { AnchorScatter } from "@/components/grades/AnchorScatter";
import { GradesClient, type ReconstructionNote } from "@/components/grades/GradesClient";
import { bases, lastCompleteMonth } from "@/lib/dcContingency";
import { ESCALATION_BASIS_TO_GRADE } from "@/lib/dcGrades";
import { DC_ANCHORS_CSV } from "@/lib/exportSpecs";
import { fmtDay, fmtSigned } from "@/lib/format";
import type { DcGrades } from "@/lib/types";
import { artifact } from "@/lib/artifact";

export const metadata: Metadata = {
  title: "Escalation grading record: did each contingency basis carry enough?",
  description:
    "Every escalation basis on the DC Escalation Calculator, graded against what DC build costs actually did — vintage-true and final-revision samples, every anchor, lead-lag and nowcasts.",
};

const build = dc.indexes.build;
const grades = artifact<"dc_grades", DcGrades>("dc_grades", gradesJson);
const { anchors, ...gradesPageData } = grades;
const strict = grades.legs?.strict;
const extended = grades.legs?.extended;

/** How far the PPI-only reconstruction the harness grades sits from the index
 *  /escalation displays — measured here from the two artifacts, never
 *  asserted. The graded index carries no live futures tail; the published one
 *  splices one onto copper/aluminium past their last print, so the two differ
 *  in the splice month, which is the anchor every basis is read at. Reads the
 *  displayed side through dcContingency's `bases()`, the same function the
 *  calculator uses. */
function measureReconstruction(): ReconstructionNote | null {
  const comps = build.components;
  const proxies = comps.filter((c) => c.mode !== "official");
  const month = lastCompleteMonth(build.monthly.months, comps.map((c) => c.last_obs));
  if (!month) return null;
  const graded = anchors.find((a) => a.leg === "extended" && a.m === month);
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

const verdictAccent = (v: string | null | undefined) =>
  v === "PASS" ? "emerald" : v === "FAIL" ? "red" : "amber";

export default function EscalationGrades() {
  const storage = grades.storage_nowcast;
  return (
    <div>
      <header className="research-intro">
        <div className="research-eyebrow">AI infrastructure · basis of estimate <span>Graded as of {fmtDay(build.as_of)}</span></div>
        <h1>Escalation grading record</h1>
        <p>
          Every rule basis the <Link href="/escalation">escalation calculator</Link> offers, graded at every
          anchor month on two samples: vintage-true, reading the DC Build index as it was first published, and
          final-revision, which reaches back further and includes a downturn. For each anchor we compute what the
          basis would have told a reader to carry and check it against what escalation did next. The metric is
          the one a capital program is judged on: did you carry enough.
        </p>
      </header>
      <BasisRecord grades={grades} />
      <div className="kpi-row">
        <KpiCard label="Strict sample" value={strict ? `${strict.anchors_n} anchors` : "—"}
          context={strict ? `${strict.span[0]} – ${strict.span[1]} · vintage-true, no downturn` : "unavailable this publish"} accent="sky" />
        <KpiCard label="Extended sample" value={extended ? `${extended.anchors_n} anchors` : "—"}
          context={extended ? `${extended.span[0]} – ${extended.span[1]} · final-revision, includes a downturn` : "unavailable this publish"} accent="violet" />
        <KpiCard label="Power nowcast" value={grades.power_nowcast?.verdict ?? "—"}
          context={grades.power_nowcast ? `vs. carry-forward · as of ${grades.power_nowcast.as_of ?? "—"}` : "unavailable this publish"}
          accent={verdictAccent(grades.power_nowcast?.verdict)} />
        <KpiCard label="Storage (NAND) tail" value={storage?.verdict ?? "—"}
          context={storage
            ? `${storage.months_graded} months graded (${storage.min_months} needed) · `
              + (storage.tail_active
                ? `tail rides at λ=${storage.best_lambda} · NAND ${fmtSigned(storage.proxy_yoy_pct)} YoY`
                : storage.verdict === "PASS"
                  ? `idle: NAND within ±${Math.round(storage.regime_min_move * 100)}% of a year ago, storage official-only`
                  : "Hardware storage is official-only")
            : "publishes with the next daily run"}
          accent={verdictAccent(storage?.verdict)} />
      </div>
      <Citation series="DC escalation grades (strict + extended legs)" asOf={build.as_of} rebase={dc.rebase}
        value={`${anchors.length} vintage anchors`} path="/escalation/grades" />
      <div className="section-tools">
        <DownloadData filename="macrogauge-dc-anchors" json="dc_grades.json"
          citation={`MacroGauge DC escalation grading anchors, published ${grades.published_at}`}
          spec={DC_ANCHORS_CSV} />
      </div>
      <GradesClient
        data={gradesPageData}
        scatter={<AnchorScatter anchors={anchors} legs={grades.legs} />}
        reconstruction={measureReconstruction()}
        anchorsN={anchors.length}
      />
    </div>
  );
}
