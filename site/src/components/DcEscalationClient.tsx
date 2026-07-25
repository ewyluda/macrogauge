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

const usd = (v: number) => {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  return abs >= 1_000_000
    ? `${sign}$${(abs / 1_000_000).toFixed(2)}M`
    : `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
};

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

  // A cost of $0 or less is not a real answer to "what does this cost" — it's
  // an unset/invalid input wearing the KPI cards' clothes. Gate the computed
  // view on a genuinely positive, finite cost so an empty or bad field shows
  // an honest prompt instead of a confident "$0" everywhere.
  const validBaseCost = Number.isFinite(baseCost) && baseCost > 0;

  // The table rounds each row's contribution to 2dp for display. Summing
  // those DISPLAYED values (not bridge()'s raw floats) is what lets the
  // TOTAL row reconcile with what a reader can see and re-add by hand — and
  // it's also why TOTAL can land a hair off Headline, which is rounded
  // independently to 1dp. Both figures are correct; they're two different,
  // honestly-labeled roundings of the same (exact, residual-free) sum.
  const displayedTotalPp = rows.reduce(
    (sum, r) => sum + Number(r.contributionPp.toFixed(2)),
    0
  );
  const totalWeight = rows.reduce((sum, r) => sum + r.weight, 0);

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

      {result && !validBaseCost && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          Enter a base cost greater than $0 to see the escalation.
        </div>
      )}

      {result && validBaseCost && (
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
                rows rounded to 2dp for display — compare TOTAL to Headline below
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
              <tfoot>
                <tr style={{ fontWeight: 600, background: "var(--bg)" }}>
                  <td>TOTAL</td>
                  <td>{(totalWeight * 100).toFixed(1)}%</td>
                  <td>—</td>
                  <td>{fmtPp(displayedTotalPp)}</td>
                  <td>—</td>
                </tr>
                <tr style={{ color: "var(--muted)", background: "var(--bg)" }}>
                  <td>Headline</td>
                  <td>—</td>
                  <td>—</td>
                  <td>{fmtSigned(result.pct)}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}>
              TOTAL adds up the rows above as printed (each rounded to 2dp); Headline is
              the true figure, rounded to 1dp. The gap between the two is that
              rounding — nothing is missing; the underlying, unrounded numbers already
              sum with no residual.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
