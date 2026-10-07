import Link from "next/link";
import type { Metadata } from "next";
import dc from "../../../public/data/datacenter.json";
import gradesJson from "../../../public/data/dc_grades.json";
import { Section } from "@/components/Section";
import { Citation } from "@/components/Citation";
import { DownloadData } from "@/components/DownloadData";
import { KpiCard } from "@/components/KpiCard";
import { fmtDay, fmtSigned } from "@/lib/format";
import { DcEscalationClient } from "@/components/DcEscalationClient";
import { BasisRecord } from "@/components/grades/BasisRecord";
import { GradesClient, type ReconstructionNote } from "@/components/grades/GradesClient";
import { GradesDisclosure } from "@/components/grades/GradesDisclosure";
import { LazyAnchorScatter } from "@/components/grades/LazyAnchorScatter";
import { ESCALATION_DATA, ESCALATION_DATA_OFFICIAL, type EscalationData } from "@/lib/escalationData";
import { bases, lastCompleteMonth } from "@/lib/dcContingency";
import { ESCALATION_BASIS_TO_GRADE, escalationGradeSlice } from "@/lib/dcGrades";
import { DC_ANCHORS_CSV } from "@/lib/exportSpecs";
import type { DcGrades } from "@/lib/types";
import { artifact } from "@/lib/artifact";

export const metadata: Metadata = {
  title: "DC Escalation Calculator",
  description:
    "Escalate your own data-center cost basis by the DC Build index, see which packages moved it, and how often each contingency basis has run short.",
};

const build = dc.indexes.build;
// Derived from the artifact on every build, NOT hand-written: which
// components carry a proxy tail past the last basket-wide print, and their
// combined weight. measureReconstruction() below derives the identical fact
// for the grading record; a hardcoded copy would go stale on the next proxy
// or weight change.
const movers = build.components.filter((c) => c.mode !== "official");
const moverWeightPct = Number(
  (movers.reduce((a, c) => a + c.weight, 0) * 100).toFixed(1));
const moverLabels = movers.map((c) => c.label).join(" and ");

const gradesFull = artifact<"dc_grades", DcGrades>("dc_grades", gradesJson);
// Only the legs cross into client components (~4KB). The 286-row `anchors`
// array (~47KB) stays out of escalation.html: the server reads it below for
// the reconstruction check, and the scatter fetches it on demand.
const grades = escalationGradeSlice(gradesFull);
const { anchors: _anchors, ...gradesPageData } = gradesFull;
const strict = gradesFull.legs?.strict;
const extended = gradesFull.legs?.extended;

/** How far the PPI-only reconstruction the harness grades sits from the index
 *  this page displays — measured on the server from the two artifacts, never
 *  asserted. The graded index carries no live futures tail; the published one
 *  splices one onto copper/aluminium past their last print, so the two differ
 *  in the splice month, which is the anchor every basis is read at. */
function measureReconstruction(): ReconstructionNote | null {
  const comps = build.components;
  const month = lastCompleteMonth(build.monthly.months, comps.map((c) => c.last_obs));
  if (!month) return null;
  const graded = gradesFull.anchors.find((a) => a.leg === "extended" && a.m === month);
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
    proxyLabels: movers.map((c) => c.label),
    proxyWeightPct: movers.reduce((a, c) => a + c.weight, 0) * 100,
    worst,
  };
}
const reconstruction = measureReconstruction();

const verdictAccent = (v: string | null | undefined) =>
  v === "PASS" ? "emerald" : v === "FAIL" ? "red" : "amber";

const data: EscalationData = ESCALATION_DATA;

export default function Escalation() {
  const storage = gradesFull.storage_nowcast;
  return (
    <div>
      <header className="research-intro">
        <div className="research-eyebrow">AI infrastructure · basis of estimate <span>Index as of {fmtDay(data.asOf)}</span></div>
        <h1>DC Escalation Calculator</h1>
        <p>
          Escalate your own base cost by the DC Build index, see which packages moved it, carry it to a delivery
          date, and check how often that carry has run short before. Drafting a contract clause? The{" "}
          <Link href="/escalation/clause">price-adjustment clause kit</Link> settles on a single official BLS
          series, with deadband, share, cap/floor and a named vintage.
        </p>
      </header>
      <DcEscalationClient data={data} officialData={ESCALATION_DATA_OFFICIAL} grades={grades} />
      <Citation live series="DC Build Index (escalation)" asOf={data.asOf} rebase={dc.rebase} value={`${fmtSigned(build.headline_yoy_pct)} YoY`} path="/escalation" />

      <Section id="grades" title="Did the basis carry enough?">
        <BasisRecord grades={grades} />
        <GradesDisclosure summary="Full grading record: paired tables, every anchor, hand-picked regimes, lead-lag and nowcasts">
          <p className="method">
            Each rule basis is graded at every anchor month on two samples: vintage-true, reading the DC Build index
            as it was first published, and final-revision, which reaches back further and includes a downturn. For
            every anchor we compute what the basis would have told a reader to carry and check it against what
            escalation actually did next. The metric is the one a capital program is judged on: did you carry
            enough.
          </p>
          <div className="kpi-row">
            <KpiCard label="Strict sample" value={strict ? `${strict.anchors_n} anchors` : "—"}
              context={strict ? `${strict.span[0]} – ${strict.span[1]} · vintage-true, no downturn` : "unavailable this publish"} accent="sky" />
            <KpiCard label="Extended sample" value={extended ? `${extended.anchors_n} anchors` : "—"}
              context={extended ? `${extended.span[0]} – ${extended.span[1]} · final-revision, includes a downturn` : "unavailable this publish"} accent="violet" />
            <KpiCard label="Power nowcast" value={gradesFull.power_nowcast?.verdict ?? "—"}
              context={gradesFull.power_nowcast ? `vs. carry-forward · as of ${gradesFull.power_nowcast.as_of ?? "—"}` : "unavailable this publish"}
              accent={verdictAccent(gradesFull.power_nowcast?.verdict)} />
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
            value={`${gradesFull.anchors.length} vintage anchors`} path="/escalation#grades" />
          <div className="section-tools">
            <DownloadData filename="macrogauge-dc-anchors" json="dc_grades.json"
              citation={`MacroGauge DC escalation grading anchors, published ${gradesFull.published_at}`}
              spec={DC_ANCHORS_CSV} />
          </div>
          <GradesClient
            data={gradesPageData}
            scatter={<LazyAnchorScatter legs={gradesFull.legs} />}
            reconstruction={reconstruction}
            anchorsN={gradesFull.anchors.length}
          />
        </GradesDisclosure>
      </Section>

      <Section title="How the calculator works">
        <div className="escalation-method">
          <p>
            <b>Your number, our index.</b> We publish an input-price index ({data.rebase}), not a turnkey $/MW
            quote, so the base cost is yours. The calculator applies the ratio between two months of the DC Build
            index and can carry a rate you choose past the last print. State parity multipliers on{" "}
            <Link href="/datacenter">/datacenter</Link> are level multipliers, not escalation rates; a real site&apos;s
            base cost already embeds its location, so they don&apos;t apply here.
          </p>
          <p>
            <b>The bridge adds up.</b> The index is a fixed-weight Laspeyres aggregate, so it is linear in its
            components: each row&apos;s contribution is <code>weight × (component index change) ÷ the headline&apos;s
            base index</code>. Unrounded, the rows sum to the headline with no residual; the table rounds each row
            to 2 decimals, which is the only gap between TOTAL and Headline.
          </p>
          <p>
            <b>Months.</b> Every month is read on its last daily-grid day (&quot;base month 2024-03&quot; means
            2024-03-31). The measured leg ends at the last month every Build component has printed; only{" "}
            {movers.length} of the {build.components.length} components ({moverLabels}, {moverWeightPct}% of the
            weight) have moved since, so anchoring a rate on that partial month would misstate a{" "}
            {movers.length}-component move as a basket-wide one.
          </p>
          <p>
            <b>The carried leg is not a forecast.</b> It compounds a rate you choose from regimes that actually
            happened: the long-run average, the post-2008 downturn, the last three years, the latest twelve months,
            or the 2021–23 spike, each shown with its exact window. We publish no central path. The shaded range is
            a count of what happened across overlapping historical windows of your length, shown with the number of
            independent draws behind it; with one downturn and one spike in the sample, read it as precedent, not
            probability. The P80 line is the 80th percentile of the same windows: the allowance that would have
            covered four in five of them.
          </p>
          <p>
            <b>Index choice.</b> The default live grid carries a futures tail for copper and aluminium until the
            next PPI replaces it, so its latest month restates. <em>Official prints only</em> is the same basket on
            the agencies&apos; own prints and moves only when BLS revises; that is the basis to cite in a
            price-adjustment clause, and its monthly series downloads on <Link href="/datacenter">/datacenter</Link>.
          </p>
        </div>
      </Section>
    </div>
  );
}
