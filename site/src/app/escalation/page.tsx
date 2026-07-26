import type { Metadata } from "next";
import dc from "../../../public/data/datacenter.json";
import { Section } from "@/components/Section";
import {
  DcEscalationClient,
  type EscalationData,
} from "@/components/DcEscalationClient";

export const metadata: Metadata = {
  title: "DC Escalation Calculator",
  description:
    "Escalate your own data-center cost basis by the DC Build index, with a per-component bridge showing what drove the change.",
};

const build = dc.indexes.build;

// Slice only what the calculator needs — the monthly grid (224 months, 2007-12
// through 2026-07, ~29.5KB), not the 3,127-point daily series — so the page
// ships a fraction of the ~614KB artifact.
const data: EscalationData = {
  months: build.monthly.months,
  index: build.monthly.index,
  componentIndex: build.monthly.components,
  components: build.components.map((c) => ({
    code: c.code,
    label: c.label,
    group: c.group,
    weight: c.weight,
  })),
  // The client derives the last COMPLETE month via min() of these — the
  // published grid's trailing month is a partial stub (only the two
  // live-proxy components move in it), so the raw grid end is unsafe to
  // anchor a rate on. See lastCompleteMonth() in dcContingency.ts.
  componentLastObs: build.components.map((c) => c.last_obs),
  asOf: build.as_of,
  rebase: dc.rebase,
};

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
        <DcEscalationClient data={data} />
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
          above — because only two of the twelve components (copper wire and aluminum
          shapes, 8.5% of the index&apos;s weight) have moved since then; anchoring a rate
          on a two-component move would misstate it as a basket-wide one. We do not predict
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
