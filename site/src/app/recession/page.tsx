import type { Metadata } from "next";
import recession from "../../../public/data/recession.json";
import { KpiCard } from "@/components/KpiCard";
import { ToneBadge } from "@/components/ToneBadge";
import { WhyLine } from "@/components/WhyLine";
import { Section } from "@/components/Section";

export const metadata: Metadata = {
  title: "Recession Composite",
  description: "Six transparent recession signals — rules, values and what's triggered, no black box.",
};

type Signal = { name: string; code: string; rule: string; value: number | null; triggered: boolean | null };

function TriggerBadge({ triggered }: { triggered: boolean | null }) {
  if (triggered == null) return <ToneBadge tone="muted" italic>unavailable</ToneBadge>;
  if (!triggered) return <ToneBadge tone="muted">no</ToneBadge>;
  return <ToneBadge tone="red">YES</ToneBadge>;
}

export default function Recession() {
  const probability = recession.probability_pct as number | null;
  const signals = recession.signals as Signal[];
  const anyTriggered = recession.triggered > 0;
  const triggeredNames = signals.filter(row => row.triggered).map(row => row.name);
  return <div><h1>Recession Composite <span className="subtitle">six transparent signals</span></h1>
    <div className="kpi-row">
      <KpiCard label="Recession composite" value={probability == null ? "—" : `${probability.toFixed(1)}%`} context={probability == null ? "awaiting signal history" : `equal-weight share of available rules · ${recession.published_at}`} accent={anyTriggered ? "red" : "emerald"} />
      <KpiCard label="Signals triggered" value={`${recession.triggered}/${recession.available}`} context="transparent rules, no black box" accent={anyTriggered ? "red" : "emerald"} />
    </div>
    <WhyLine label="Status:">{recession.triggered} of {recession.available} available signals are triggered{triggeredNames.length > 0 ? ` — ${triggeredNames.join(", ")}` : ""}.</WhyLine>
    <Section title="Signal rules">
      <div className="table-card"><table className="data-table"><thead><tr><th>Signal</th><th style={{ textAlign: "left" }}>Rule</th><th>Value</th><th>Triggered</th></tr></thead><tbody>{signals.map(row => <tr key={row.code}><td>{row.name}</td><td style={{ textAlign: "left" }}>{row.rule}</td><td>{row.value ?? "—"}</td><td><TriggerBadge triggered={row.triggered} /></td></tr>)}</tbody></table></div>
    </Section>
    <p className="method">The composite is the equal-weight share of available rules currently triggered. It is a signal dashboard, not a fitted recession probability. A red YES badge marks a rule currently met; unavailable means the signal’s input is missing and it is excluded from the share.</p></div>;
}
