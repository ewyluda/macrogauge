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
    "Escalate your own data-center cost basis by the DC Build index, with a component bridge that sums exactly to the headline.",
};

const build = dc.indexes.build;

// Slice only what the calculator needs — the monthly grid, not the 3,124-point
// daily series — so the page ships ~20KB instead of fetching the 517KB artifact.
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
          index. Because the index is a fixed-weight Laspeyres aggregate, it is exactly
          linear in its components: each row&apos;s contribution is{" "}
          <code>weight × (component index change) ÷ base index</code>, and the rows sum to
          the headline escalation with no residual.
          {" "}The window runs to the index&apos;s latest observation ({data.asOf}).
          Escalation is national — state parity multipliers on{" "}
          <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a> are{" "}
          <em>level</em> multipliers (cost relative to the national average), not escalation
          rates; your base cost for a real site already embeds its location, so applying them
          here would count location twice.
          {" "}This is history, not a forecast: it measures what input prices have already
          done, and stops at the last print. See{" "}
          <a href="/methodology" style={{ color: "var(--accent-sky)" }}>methodology</a> for
          component sources and weights.
        </div>
      </Section>
    </div>
  );
}
