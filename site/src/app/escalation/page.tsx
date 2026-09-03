import type { Metadata } from "next";
import dc from "../../../public/data/datacenter.json";
import gradesJson from "../../../public/data/dc_grades.json";
import { Section } from "@/components/Section";
import { Citation } from "@/components/Citation";
import { fmtSigned } from "@/lib/format";
import { DcEscalationClient } from "@/components/DcEscalationClient";
import { ESCALATION_DATA, type EscalationData } from "@/lib/escalationData";
import { escalationGradeSlice } from "@/lib/dcGrades";
import type { DcGrades } from "@/lib/types";

export const metadata: Metadata = {
  title: "DC Escalation Calculator",
  description:
    "Escalate your own data-center cost basis by the DC Build index, with a per-component bridge showing what drove the change.",
};

const build = dc.indexes.build;
// Derived from the artifact on every build, NOT hand-written: which
// components carry a proxy tail past the last basket-wide print, and their
// combined weight. /dc-scoreboard derives the identical fact live
// (measureReconstruction); a hardcoded copy here would silently go stale on
// the next proxy or weight change.
const movers = build.components.filter((c) => c.mode !== "official");
const moverWeightPct = Number(
  (movers.reduce((a, c) => a + c.weight, 0) * 100).toFixed(1));
const moverLabels = movers.map((c) => c.label).join(" and ");
// The inline paired verdict reads `legs` and nothing else. Passing the whole
// artifact would serialize its 286-row `anchors` array (~47KB of the ~58KB
// file) into escalation.html for a component that never touches it — the load
// cost the design spec says this page does not take on. The slice is ~4KB.
const grades = escalationGradeSlice(gradesJson as unknown as DcGrades);

const data: EscalationData = ESCALATION_DATA;

export default function Escalation() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        DC Escalation Calculator{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          escalate your own base cost by the DC Build index — and see exactly which
          packages moved it
        </span>
      </h1>
      <div style={{ marginTop: 24 }}>
        <DcEscalationClient data={data} grades={grades} />
        <Citation live series="DC Build Index (escalation)" asOf={data.asOf} rebase={dc.rebase} value={`${fmtSigned(build.headline_yoy_pct)} YoY`} path="/escalation" />
      </div>
      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          This escalates <em>your</em> number. We publish an input-price index
          ({data.rebase}), not a turnkey $/MW quote — so the base cost is yours to supply,
          and the calculator applies the ratio between two months of the DC Build index,
          and optionally carries a rate you choose past the last print. Because the index
          is a fixed-weight Laspeyres aggregate, it is linear in
          its components: each row&apos;s contribution is{" "}
          <code>weight × (component index change) ÷ the headline&apos;s base index</code> —
          not the component&apos;s own base index (see the note above the bridge table). In
          the underlying numbers, the contributions sum to the headline escalation with no
          residual — but each row in the table is rounded to 2 decimal places for display, so
          the printed rows can land a few hundredths of a point away from the headline. The
          TOTAL row under the table adds up what&apos;s printed; Headline shows the real
          figure — the difference between them is that rounding, nothing more.
          {" "}Every month here is sampled on its last daily-grid day, not the first —
          &quot;base month 2024-03&quot; means 2024-03-31 — except the window&apos;s end,
          which stops at the index&apos;s latest observation ({data.asOf}) and is therefore a
          partial month.
          Escalation is national — state parity multipliers on{" "}
          <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a> are{" "}
          <em>level</em> multipliers (cost relative to the national average), not escalation
          rates; your base cost for a real site already embeds its location, so applying them
          here would count location twice.
          {" "}The measured leg above is history: it stops at the index&apos;s last print,
          and nothing past that print is asserted. The <em>deliver by</em> leg is not a
          forecast either — it carries forward a rate you choose from regimes that have
          actually occurred (the long-run average, the post-2008 downturn, the last three
          years, the latest twelve months, or the 2021–23 spike), each shown with the exact
          window it was measured over. Those windows measure to the last month every Build
          component actually reports a full print for — not to the partial month noted
          above — because only {movers.length} of the {build.components.length}{" "}
          components ({moverLabels}, {moverWeightPct}% of the index&apos;s weight) have
          moved since then; anchoring a rate
          on a {movers.length}-component move would misstate it as a basket-wide one. We do not predict
          which regime will obtain, and we
          publish no central path. The realized band underneath the table is a count of
          what happened across overlapping historical windows of the same length as yours,
          reported alongside the number of independent draws behind it — a small number,
          over a sample containing one downturn and one spike, best read as a range of
          precedents rather than a probability. Component sources and weights are
          documented on{" "}
          <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a>.
        </div>
      </Section>
    </div>
  );
}
