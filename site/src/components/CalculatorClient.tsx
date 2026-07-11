"use client";
import { useEffect, useState } from "react";
import { EChart } from "./EChart";
import { KpiCard } from "./KpiCard";
import { C, baseOption } from "@/lib/chartTheme";
import { sinceStats } from "@/lib/since";

type GaugeDaily = {
  variants: { gauge: { dates: string[]; index: number[] } };
};

export function CalculatorClient() {
  const [data, setData] = useState<GaugeDaily | null>(null);
  const [since, setSince] = useState("2020-01-01");
  const [amount, setAmount] = useState(100);

  useEffect(() => {
    fetch("/data/gauge_daily.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading daily gauge index…
      </div>
    );
  }
  const { dates, index } = data.variants.gauge;
  const s = sinceStats(dates, index, since, amount);
  const from = s ? dates.indexOf(s.startDate) : 0;
  const base = baseOption();
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
          SINCE{" "}
          <input
            type="date"
            min={dates[0]}
            max={dates[dates.length - 1]}
            value={since}
            onChange={(e) => setSince(e.target.value)}
            style={input}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          AMOUNT ($){" "}
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ ...input, width: 90 }}
          />
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          try: lease signing day, your last raise, your kid&apos;s birthday
        </span>
      </div>

      {s && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
            <KpiCard
              label={`Prices since ${s.startDate}`}
              value={`${s.pctSince >= 0 ? "+" : "−"}${Math.abs(s.pctSince).toFixed(2)}%`}
              context={`through ${dates[dates.length - 1]} — updated with every publish`}
              accent={s.pctSince >= 0 ? "red" : "emerald"}
            />
            <KpiCard
              label={`$${amount} then costs now`}
              value={`$${s.thenNow.toFixed(2)}`}
              context={`same basket, today's prices · through ${dates[dates.length - 1]}`}
              accent="amber"
            />
            <KpiCard
              label={`$${amount} now buys what this bought`}
              value={`$${s.buys.toFixed(2)}`}
              context={`purchasing power remaining · through ${dates[dates.length - 1]}`}
              accent="sky"
            />
            <KpiCard
              label="Annualized rate over the period"
              value={`${s.annualizedPct.toFixed(2)}%/yr`}
              context={`${s.days} days`}
              accent="violet"
            />
          </div>
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "12px 8px 4px",
              marginTop: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--muted)",
                padding: "0 8px",
              }}
            >
              The price level since {s.startDate} (Jan 2018 = 100)
            </div>
            <EChart
              option={{
                ...base,
                legend: { show: false },
                // this chart plots the unitless index level (Jan 2018 = 100),
                // not a percent — drop baseOption()'s "%" valueFormatter
                tooltip: {
                  ...base.tooltip,
                  valueFormatter: (v: unknown) =>
                    typeof v === "number" ? v.toFixed(2) : "—",
                },
                series: [
                  {
                    name: "Gauge index",
                    type: "line",
                    showSymbol: false,
                    lineStyle: { width: 1.5 },
                    color: C.sky,
                    data: dates
                      .slice(from)
                      .map((d, i) => [d, index[from + i]] as [string, number]),
                  },
                ],
                yAxis: {
                  ...base.yAxis,
                  axisLabel: { color: C.muted },
                  scale: true,
                },
              }}
              height={340}
            />
          </div>
        </>
      )}
    </div>
  );
}
