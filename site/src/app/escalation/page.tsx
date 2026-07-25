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

// Slice only what the calculator needs — the monthly grid, not the 3,124-point
// daily series — so the page ships ~14.2KB instead of fetching the ~575KB artifact.
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
          and the calculator only applies the ratio between two months of the DC Build
          index. Because the index is a fixed-weight Laspeyres aggregate, it is linear in
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
          {" "}This is history, not a forecast: it measures what input prices have already
          done, and stops at the last print. Component sources and weights are documented
          on{" "}
          <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a>.
        </div>
      </Section>
    </div>
  );
}
