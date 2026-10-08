import type { Metadata } from "next";
import heat from "../../../public/data/heatcheck.json";
import stress from "../../../public/data/stress.json";
import recession from "../../../public/data/recession.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { ToneBadge } from "@/components/ToneBadge";
import { WhyLine } from "@/components/WhyLine";
import { LinesChart } from "@/components/LinesChart";
import { TailSpark } from "@/components/TailSpark";
import { C } from "@/lib/chartTheme";
import { fmtStamp } from "@/lib/format";
import { fmtIndicatorValue, indicatorLabel } from "@/lib/indicatorLabels";
import { distanceToTrigger, macroCycleSentence, type RecessionSignal } from "@/lib/macroCycle";

type HeatIndicator = { code: string; group: string; direction: number; momentum: number; z: number; as_of: string; mode?: string };
type Group = { z: number; weight: number; available: number; expected: number; active_weight: number };
type StressIndicator = { code: string; value: number; score: number; weight: number; as_of: string; direction?: number };
type History = { dates: string[]; score: (number | null)[] };

const heatScore = heat.score as number | null;
const stressScore = stress.score as number | null;
const heatHistory = (heat as { history?: History }).history;
const stressHistory = (stress as { history?: History }).history;
const signals = recession.signals as RecessionSignal[];
const sentence = macroCycleSentence(heatScore, stressScore, recession.triggered, recession.available);

export const metadata: Metadata = {
  title: `Macro Cycle${sentence ? `: ${sentence.replace(/\.$/, "")}` : ""}`,
  description: "The economy's heat, consumer stress and six recession rules on one page: standardized momentum, percentile stress and the distance to each rule's trigger.",
};

// Presentation-only buckets on the published numbers — no new numbers.
const bucket = (z: number) => (z > 0.25 ? "heating" : z < -0.25 ? "cooling" : "neutral");
const zColor = (z: number) => (bucket(z) === "heating" ? "var(--accent-red)" : bucket(z) === "cooling" ? "var(--accent-emerald)" : "var(--muted)");
const signed = (z: number) => `${z >= 0 ? "+" : ""}${z.toFixed(2)}`;
const severity = (s: number) => (s >= 80 ? "elevated" : s >= 50 ? "watch" : "calm");

function HeatBadge({ z }: { z: number }) {
  const b = bucket(z);
  if (b === "neutral") return <ToneBadge tone="muted">NEUTRAL</ToneBadge>;
  return <ToneBadge tone={b === "heating" ? "red" : "emerald"}>{b === "heating" ? "HEATING" : "COOLING"}</ToneBadge>;
}

export default function MacroCycle() {
  const indicators = heat.indicators as HeatIndicator[];
  const groups = heat.groups as Record<string, Partial<Group>>;
  const movers = [...indicators].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).filter((r) => bucket(r.z) !== "neutral").slice(0, 2);
  const stressRows = stress.indicators as StressIndicator[];
  const top = [...stressRows].sort((a, b) => b.score - a.score)[0];
  return (
    <div>
      <h1>Macro Cycle <span className="subtitle">heat, consumer stress and recession rules, on one page</span></h1>
      {sentence && <p className="ll-takeaway" data-testid="macro-sentence">{sentence}</p>}
      <div className="kpi-row">
        <KpiCard label="Heat score" value={heatScore == null ? "—" : heatScore.toFixed(1)}
          context={`−100 cooling · +100 heating · ${heat.coverage_pct.toFixed(0)}% coverage`} accent={(heatScore ?? 0) >= 0 ? "red" : "emerald"} />
        <KpiCard label="Consumer stress" value={stressScore == null ? "—" : stressScore.toFixed(1)}
          context={`0 low · 100 severe · ${stress.coverage_pct.toFixed(0)}% coverage`} accent="amber" />
        <KpiCard label="Recession rules triggered" value={`${recession.triggered}/${recession.available}`}
          context={`transparent rules, no black box · published ${fmtStamp(recession.published_at)}`} accent={recession.triggered > 0 ? "red" : "emerald"} />
      </div>

      <Section title="Heat — standardized momentum across the economy, last five years" id="heat">
        {heatHistory && (
          <div className="chart-card">
            <LinesChart height={260} refLine={0} refLabel="neutral" yUnit=""
              series={[{ name: "Heat score", x: heatHistory.dates, y: heatHistory.score, color: C.red }]} />
          </div>
        )}
        <WhyLine label="Biggest movers:">{movers.length > 0
          ? `${movers.map((r) => `${indicatorLabel(r.code)} is ${bucket(r.z)} (z ${signed(r.z)})`).join(" and ")}.`
          : "every indicator is inside the ±0.25 neutral band."}</WhyLine>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {Object.entries(groups).map(([name, g]) => (
            <div key={name} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", minWidth: 140 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{name.replaceAll("_", " ")}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: g.z == null ? "var(--muted)" : zColor(g.z), fontVariantNumeric: "tabular-nums" }}>{g.z == null ? "—" : signed(g.z)}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>weight {g.weight ?? "—"} · {g.available ?? "—"}/{g.expected ?? "—"} live</div>
            </div>
          ))}
        </div>
        <details className="inv-details">
          <summary>All {indicators.length} heat indicators</summary>
          <div className="table-card"><table className="data-table"><thead><tr><th>Indicator</th><th>Group</th><th>Signal</th><th>Momentum</th><th>Sign</th><th>Signed z</th><th>As of</th></tr></thead><tbody>
            {indicators.map((row) => <tr key={row.code}><td>{indicatorLabel(row.code)} <span style={{ color: "var(--muted)", fontSize: 11 }}>{row.code}</span></td><td>{row.group.replaceAll("_", " ")}</td><td><HeatBadge z={row.z} /></td><td>{row.momentum.toFixed(2)}{row.mode === "diff" ? "pp" : "%"}</td><td style={{ color: "var(--muted)" }}>{row.direction >= 0 ? "↑ heats" : "↓ heats"}</td><td>{row.z.toFixed(2)}</td><td>{row.as_of}</td></tr>)}
          </tbody></table></div>
        </details>
        <p className="method">Each indicator&apos;s momentum over roughly three months is z-scored against its own history (median and MAD), clamped to ±2.5 and signed so positive means heating; groups weight Prices 25, Real Economy 25, Pipeline 20, Housing 15, Money &amp; Expectations 15. The five-year line recomputes the score at each month-end from today&apos;s data, so revised series move under it: it is not what the score read at the time.</p>
      </Section>

      <Section title="Consumer stress — delinquencies, debt service and saving" id="stress">
        <div className="kpi-row" style={{ alignItems: "center" }}>
          <KpiCard label="Stress score" value={stressScore == null ? "—" : stressScore.toFixed(1)}
            context={`${stress.coverage_pct.toFixed(0)}% weighted coverage · published ${fmtStamp(stress.published_at)}`} accent="red" />
          {stressHistory && <div data-testid="stress-trail"><TailSpark tail={stressHistory.score} stroke="var(--accent-amber)" label="Consumer stress score, five years" />
            <small style={{ color: "var(--muted)" }}>five years, monthly</small></div>}
        </div>
        {top && <WhyLine label="Most stretched:">{indicatorLabel(top.code)}, percentile score {top.score.toFixed(1)} of 100 ({severity(top.score)}).</WhyLine>}
        <details className="inv-details">
          <summary>All {stressRows.length} stress inputs</summary>
          <div className="table-card"><table className="data-table"><thead><tr><th>Indicator</th><th>Value</th><th>Sign</th><th>Percentile score</th><th>Weight</th><th>As of</th></tr></thead><tbody>
            {stressRows.map((row) => <tr key={row.code}><td>{indicatorLabel(row.code)} <span style={{ color: "var(--muted)", fontSize: 11 }}>{row.code}</span></td><td>{fmtIndicatorValue(row.code, row.value)}</td><td style={{ color: "var(--muted)" }}>{(row.direction ?? 1) >= 0 ? "↑ stress" : "↓ stress"}</td><td>{row.score.toFixed(1)}</td><td>{row.weight}%</td><td>{row.as_of}</td></tr>)}
          </tbody></table></div>
        </details>
        <p className="method">Every input is percentile-scored against its own history since 2019 and direction-adjusted; missing inputs reduce coverage and are not imputed. The trail recomputes the score at each month-end from today&apos;s data.</p>
      </Section>

      <Section title="Recession rules — how far each is from triggering" id="recession">
        <div className="table-card"><table className="data-table" data-testid="recession-rules"><thead><tr><th>Signal</th><th style={{ textAlign: "left" }}>Rule</th><th>Value</th><th style={{ textAlign: "left", minWidth: 220 }}>Distance to trigger</th><th>As of</th></tr></thead><tbody>
          {signals.map((s) => {
            const d = distanceToTrigger(s);
            return (
              <tr key={s.code}>
                <td>{s.name}</td>
                <td style={{ textAlign: "left" }}>{s.rule}</td>
                <td>{s.value ?? "—"}</td>
                <td style={{ textAlign: "left" }}>{d ? (
                  <span className="mc-room" title="bar full = at least the rule's design scale of room">
                    <span className="mc-room-bar"><span style={{ width: `${(s.triggered ? 1 : d.share) * 100}%`, background: s.triggered ? "var(--accent-red)" : "var(--accent-emerald)" }} /></span>
                    <span>{d.label}</span>
                  </span>
                ) : s.triggered == null ? <ToneBadge tone="muted" italic>unavailable</ToneBadge> : (s.triggered ? <ToneBadge tone="red">YES</ToneBadge> : <ToneBadge tone="muted">no</ToneBadge>)}</td>
                <td style={{ color: "var(--muted)" }}>{s.as_of ?? "—"}</td>
              </tr>
            );
          })}
        </tbody></table></div>
        <p className="method">Each rule is a published threshold (Sahm, the 10-year less 3-month spread, the Chicago Fed financial conditions and activity indexes, claims, Chauvet-Piger). The green bar is the room left before a rule triggers, full at a stated design scale per rule (0.5pp for Sahm, 1.5pp for the curve, 0.75 for NFCI, 15 points for claims, 1.0 for CFNAI, 20pp for Chauvet-Piger); a triggered rule fills red. The composite count is the equal-weight share of available rules triggered: a signal dashboard, not a fitted recession probability.</p>
      </Section>
    </div>
  );
}
