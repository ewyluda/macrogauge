import Link from "next/link";
import type { Metadata } from "next";
import dc from "../../../public/data/datacenter.json";
import gradesJson from "../../../public/data/dc_grades.json";
import { Section } from "@/components/Section";
import { Citation } from "@/components/Citation";
import { fmtDay, fmtSigned } from "@/lib/format";
import { DcEscalationClient } from "@/components/DcEscalationClient";
import { BasisRecord } from "@/components/grades/BasisRecord";
import { ESCALATION_DATA, ESCALATION_DATA_OFFICIAL, type EscalationData } from "@/lib/escalationData";
import { escalationGradeSlice } from "@/lib/dcGrades";
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
// combined weight. /escalation/grades derives the identical fact for its
// reconstruction check; a hardcoded copy would go stale on the next proxy or
// weight change.
const movers = build.components.filter((c) => c.mode !== "official");
const moverWeightPct = Number(
  (movers.reduce((a, c) => a + c.weight, 0) * 100).toFixed(1));
const moverLabels = movers.map((c) => c.label).join(" and ");

// Only the legs slice crosses into this page (~4KB): the 286-row `anchors`
// array (~47KB) and the full record live on /escalation/grades.
const grades = escalationGradeSlice(artifact<"dc_grades", DcGrades>("dc_grades", gradesJson));

const data: EscalationData = ESCALATION_DATA;

export default function Escalation() {
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
        <Link href="/escalation/grades" className="grades-record-link">
          Full grading record: paired tables, every anchor, hand-picked regimes, lead-lag and nowcasts →
        </Link>
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
