import type { Metadata } from "next";
import heat from "../../../public/data/heatcheck.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { ToneBadge } from "@/components/ToneBadge";
import { WhyLine } from "@/components/WhyLine";
import { indicatorLabel } from "@/lib/indicatorLabels";

export const metadata: Metadata = {
  title: "Economy Heat Check",
  description: "One standardized momentum score across prices, pipeline, labor and demand — −100 cooling to +100 heating.",
};

type Indicator = { code: string; group: string; direction: number; momentum: number; z: number; as_of: string; mode?: string; periods?: number };
type Group = { z: number; weight: number; available: number; expected: number; active_weight: number };

// Presentation-only sign buckets on the published z — no new numbers.
function bucket(z: number): "heating" | "cooling" | "neutral" {
  return z > 0.25 ? "heating" : z < -0.25 ? "cooling" : "neutral";
}

function zColor(z: number): string {
  const b = bucket(z);
  return b === "heating" ? "var(--accent-red)" : b === "cooling" ? "var(--accent-emerald)" : "var(--muted)";
}

function HeatBadge({ z }: { z: number }) {
  const b = bucket(z);
  if (b === "neutral") return <ToneBadge tone="muted">NEUTRAL</ToneBadge>;
  const hot = b === "heating";
  return (
    <ToneBadge tone={hot ? "red" : "emerald"}>
      {hot ? "HEATING" : "COOLING"}
    </ToneBadge>
  );
}

const signed = (z: number) => `${z >= 0 ? "+" : ""}${z.toFixed(2)}`;

export default function Heatcheck() {
  const indicators = heat.indicators as Indicator[];
  // groups is schema-unpinned ({"type":"object"}) — treat every field as optional
  const groups = heat.groups as Record<string, Partial<Group>>;
  // factual biggest-movers framing (not causal attribution — the published
  // score is group-weighted, so top-|z| is not necessarily top-contribution),
  // and sub-threshold "movers" are excluded so a flat month reads honestly
  const movers = [...indicators]
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .filter((r) => bucket(r.z) !== "neutral")
    .slice(0, 2);
  return <div><h1>Economy Heat Check <span className="subtitle">−100 cooling · +100 heating</span></h1>
    <div className="kpi-row"><KpiCard label="Heat score" value={heat.score.toFixed(1)} context={`${heat.coverage_pct.toFixed(1)}% indicator coverage · ${heat.published_at}`} accent={heat.score >= 0 ? "red" : "emerald"} /></div>
    <WhyLine label="Biggest movers:">{movers.length > 0
      ? `${movers.map(row => `${indicatorLabel(row.code)} is ${bucket(row.z)} (z ${signed(row.z)})`).join(" and ")}.`
      : "every indicator is inside the ±0.25 neutral band."}</WhyLine>
    <Section title="Group subtotals">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {Object.entries(groups).map(([name, g]) => <div key={name} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", minWidth: 140 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{name.replaceAll("_", " ")}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: g.z == null ? "var(--muted)" : zColor(g.z), fontVariantNumeric: "tabular-nums" }}>{g.z == null ? "—" : signed(g.z)}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>weight {g.weight ?? "—"} · {g.available ?? "—"}/{g.expected ?? "—"} live</div>
        </div>)}
      </div>
    </Section>
    <Section title="Indicator detail">
      <div className="table-card"><table className="data-table"><thead><tr><th>Indicator</th><th>Group</th><th>Signal</th><th>Momentum</th><th>Signed z</th><th>As of</th></tr></thead><tbody>{indicators.map(row => <tr key={row.code}><td>{indicatorLabel(row.code)} <span style={{ color: "var(--muted)", fontSize: 11 }}>{row.code}</span></td><td>{row.group.replaceAll("_", " ")}</td><td><HeatBadge z={row.z} /></td><td>{row.momentum.toFixed(2)}{row.mode === "diff" ? "pp" : "%"}</td><td>{row.z.toFixed(2)}</td><td>{row.as_of}</td></tr>)}</tbody></table></div>
    </Section>
    <p className="method">Each indicator’s momentum over roughly three months (3 monthly, 13 weekly, or 63 daily periods; rates and spreads as point changes, everything else as % change) is z-scored against its own available history, clamped to ±2.5, and signed so positive means heating. Group weights: Prices 25, Real Economy 25, Pipeline 20, Housing 15, Money &amp; Expectations 15. Group tiles show the published per-group subtotals (mean z, weight, available/expected inputs); row badges bucket the published z — HEATING above +0.25, COOLING below −0.25, NEUTRAL between.</p></div>;
}
