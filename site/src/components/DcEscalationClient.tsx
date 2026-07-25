"use client";
import { useState } from "react";
import { KpiCard } from "./KpiCard";
import { bridge, escalate, type BridgeComponent } from "@/lib/dcEscalation";
import { fmtPp, fmtSigned } from "@/lib/format";

export type EscalationData = {
  months: string[];
  index: number[];
  componentIndex: Record<string, number[]>;
  components: BridgeComponent[];
  asOf: string;
  rebase: string;
};

const usd = (v: number) =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)}M`
    : `$${Math.round(v).toLocaleString("en-US")}`;

export function DcEscalationClient({ data }: { data: EscalationData }) {
  const firstMonth = data.months[0];
  const lastMonth = data.months[data.months.length - 1];
  const [baseMonth, setBaseMonth] = useState(
    data.months[Math.max(0, data.months.length - 25)]
  );
  const [baseCost, setBaseCost] = useState(9_000_000);

  const result = escalate(data.months, data.index, baseMonth, baseCost);
  const rows = bridge(
    data.months,
    data.componentIndex,
    data.components,
    baseMonth,
    baseCost
  );
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.contributionPp)), 0.01);

  const input: React.CSSProperties = {
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          BASE MONTH{" "}
          <input
            type="month"
            min={firstMonth}
            max={lastMonth}
            value={baseMonth}
            onChange={(e) => setBaseMonth(e.target.value)}
            style={input}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          BASE COST ($){" "}
          <input
            type="number"
            min={1}
            step={100000}
            value={baseCost}
            onChange={(e) => {
              // A cleared field parses to 0 (Number("") === 0), which is a
              // valid finite cost and renders zeroed-out KPI cards. Anything
              // that doesn't parse to a finite number (partial/invalid input,
              // paste, programmatic set) falls back to that same 0 rather
              // than letting NaN propagate into every downstream figure.
              const v = Number(e.target.value);
              setBaseCost(Number.isFinite(v) ? v : 0);
            }}
            style={{ ...input, width: 140 }}
          />
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          your own $/MW, or the whole project — the math is a ratio, so the unit is yours
        </span>
      </div>

      {!result && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          The index starts in {firstMonth}. Pick a later base month.
        </div>
      )}

      {result && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
            <KpiCard
              label={`Escalated to ${result.endMonth}`}
              value={usd(result.escalatedCost)}
              context={`from ${usd(baseCost)} in ${result.baseMonth} · DC Build index`}
              accent="sky"
            />
            <KpiCard
              label="Total escalation"
              value={fmtSigned(result.pct)}
              context={`${result.monthsElapsed} months · index ${result.baseIndex.toFixed(1)} → ${result.endIndex.toFixed(1)}`}
              accent={result.pct >= 0 ? "red" : "emerald"}
            />
            <KpiCard
              label="Annualized rate"
              value={`${result.annualizedPct.toFixed(2)}%/yr`}
              context="compound, over the window you chose"
              accent="violet"
            />
            <KpiCard
              label="Escalation dollars"
              value={usd(result.deltaCost)}
              context="the delta the bridge below decomposes"
              accent="amber"
            />
          </div>

          <div className="table-card" style={{ marginTop: 16 }}>
            <h2>
              What drove it{" "}
              <span className="subtitle">
                contributions sum to {fmtSigned(result.pct)} — the headline, exactly
              </span>
            </h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Weight</th>
                  <th>Its own escalation</th>
                  <th>Contribution</th>
                  <th>Of your delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td>{r.label}</td>
                    <td>{(r.weight * 100).toFixed(1)}%</td>
                    <td>{fmtSigned(r.componentPct)}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          verticalAlign: "middle",
                          height: 8,
                          borderRadius: 2,
                          width: `${(Math.abs(r.contributionPp) / maxAbs) * 90}px`,
                          background:
                            r.contributionPp >= 0
                              ? "var(--accent-red)"
                              : "var(--accent-emerald)",
                        }}
                      />
                      <span style={{ marginLeft: 6 }}>{fmtPp(r.contributionPp)}</span>
                    </td>
                    <td>{usd(r.contributionCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
