"use client";
import { useState } from "react";
import { realRaisePct } from "@/lib/realwage";
import { fmtPp } from "@/lib/format";

function ResultChip({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 0 ? "var(--accent-emerald)" : "var(--accent-red)";
  return (
    <div
      style={{
        background: "var(--chip-bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "10px 16px",
        minWidth: 210,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
        {pct >= 0 ? "+" : "−"}
        {Math.abs(pct).toFixed(2)}% real
      </div>
    </div>
  );
}

export function RaiseCalculator({
  gaugeYoy,
  officialYoy,
}: {
  gaugeYoy: number;
  officialYoy: number;
}) {
  const [raise, setRaise] = useState(4.0);
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--accent-emerald)",
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 10,
        }}
      >
        Your raise, in real terms
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 14 }}>
          My raise this year:{" "}
          <input
            type="number"
            step={0.1}
            value={raise}
            onChange={(e) => setRaise(Number(e.target.value))}
            style={{
              width: 70,
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              fontVariantNumeric: "tabular-nums",
            }}
          />{" "}
          %
        </label>
        <ResultChip
          label="vs today's prices (macrogauge)"
          pct={realRaisePct(raise, gaugeYoy)}
        />
        <ResultChip label="vs official CPI" pct={realRaisePct(raise, officialYoy)} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
        Real change = (1 + raise) ÷ (1 + inflation) − 1 · gauge{" "}
        {fmtPp(gaugeYoy - officialYoy)} vs official
      </div>
    </div>
  );
}
