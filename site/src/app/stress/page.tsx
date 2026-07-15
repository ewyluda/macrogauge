import type { Metadata } from "next";
import stress from "../../../public/data/stress.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { ToneBadge } from "@/components/ToneBadge";
import { WhyLine } from "@/components/WhyLine";
import { indicatorLabel } from "@/lib/indicatorLabels";

export const metadata: Metadata = {
  title: "Consumer Stress Index",
  description: "Delinquencies, debt service and savings pressure in one 0–100 score.",
};

type Indicator = { code: string; value: number; score: number; weight: number; as_of: string };

// Presentation-only buckets on the published percentile score — no new numbers.
function severityWord(score: number): "elevated" | "watch" | "calm" {
  return score >= 80 ? "elevated" : score >= 50 ? "watch" : "calm";
}

function SeverityBadge({ score }: { score: number }) {
  const word = severityWord(score);
  if (word === "calm") return <ToneBadge tone="muted">calm</ToneBadge>;
  return (
    <ToneBadge tone={word === "elevated" ? "red" : "amber"}>{word}</ToneBadge>
  );
}

export default function Stress() {
  const score = stress.score as number | null;
  const indicators = stress.indicators as Indicator[];
  const top = [...indicators].sort((a, b) => b.score - a.score)[0];
  return <div><h1>Consumer Stress Index <span className="subtitle">0 low · 100 severe</span></h1>
    <div className="kpi-row"><KpiCard label="Stress score" value={score == null ? "—" : score.toFixed(1)} context={`${stress.coverage_pct.toFixed(0)}% weighted coverage · ${stress.published_at}`} accent="red" /></div>
    {top && <WhyLine label="Most stretched:">{indicatorLabel(top.code)} — percentile score {top.score.toFixed(1)} of 100 ({severityWord(top.score)}).</WhyLine>}
    <Section title="Stress inputs">
      <div className="table-card"><table className="data-table"><thead><tr><th>Indicator</th><th>Severity</th><th>Value</th><th>Percentile score</th><th>Weight</th><th>As of</th></tr></thead><tbody>{indicators.map(row => <tr key={row.code}><td>{indicatorLabel(row.code)} <span style={{ color: "var(--muted)", fontSize: 11 }}>{row.code}</span></td><td><SeverityBadge score={row.score} /></td><td>{row.value}</td><td>{row.score.toFixed(1)}</td><td>{row.weight}%</td><td>{row.as_of}</td></tr>)}</tbody></table></div>
    </Section>
    <p className="method">Every input is percentile-scored against its own history since 2019 and direction-adjusted. Missing inputs reduce coverage and are not imputed. Severity badges bucket the published percentile score — elevated at 80+, watch at 50+, calm below.</p></div>;
}
