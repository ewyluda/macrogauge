"use client";
import { useEffect, useMemo, useState } from "react";
import { EChart } from "./EChart";
import { SegmentedControl } from "./SegmentedControl";
import { C, baseOption } from "@/lib/chartTheme";
import { heatColor } from "@/lib/heat";
import { fmtPct } from "@/lib/format";
import type { Geo } from "@/lib/types";
import {
  DEFAULT_ANSWERS,
  MULTIPLIER_NOTES,
  applyAnswers,
  contributions,
  renormalize,
  weightedYoY,
  type Answers,
  type Comp,
} from "@/lib/reweight";

type Replay = { dates: string[]; components: Comp[] };

const ROWS: {
  key: keyof Answers;
  label: string;
  options: readonly { key: string; label: string }[];
}[] = [
  { key: "housing", label: "🏠 Housing",
    options: [
      { key: "rent", label: "I rent" },
      { key: "own_mortgage", label: "Own w/ mortgage" },
      { key: "own_paidoff", label: "Own, paid off" },
    ] },
  { key: "driving", label: "🚗 Driving",
    options: [
      { key: "none", label: "Don't drive" },
      { key: "average", label: "Average miles" },
      { key: "heavy", label: "Heavy commuter" },
    ] },
  { key: "eating", label: "🍽 Eating out",
    options: [
      { key: "cook", label: "Mostly cook" },
      { key: "average", label: "Average" },
      { key: "out", label: "Eat out a lot" },
    ] },
  { key: "healthcare", label: "🩺 Healthcare use",
    options: [
      { key: "light", label: "Light" },
      { key: "average", label: "Average" },
      { key: "heavy", label: "Heavy" },
    ] },
  { key: "tuition", label: "🎓 Paying tuition",
    options: [
      { key: "no", label: "No" },
      { key: "yes", label: "Yes" },
    ] },
];

export function MyInflationClient({
  compareMonths,
  compareGauge,
  gaugeYoy,
  gaugeAsOf,
  states,
}: {
  compareMonths: string[];
  compareGauge: (number | null)[];
  gaugeYoy: number;
  gaugeAsOf: string;
  states: Geo["states"];
}) {
  const [data, setData] = useState<Replay | null>(null);
  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);
  const [stateSel, setStateSel] = useState("US");

  useEffect(() => {
    fetch("/data/replay.json")
      .then((r) => r.json())
      .then((d: Replay) => setData(d))
      .catch(() => setData(null));
  }, []);

  const weights = useMemo(
    () => (data ? renormalize(applyAnswers(data.components, answers)) : null),
    [data, answers]
  );

  const overrides = useMemo(() => {
    if (stateSel === "US") return undefined;
    const st = states.find((s) => s.state === stateSel);
    if (!st) return undefined;
    const o: Record<string, number> = {};
    if (st.elec_res_cents.yoy_pct != null) o.electricity = st.elec_res_cents.yoy_pct;
    if (st.gas_regular.yoy_pct != null) o.fuel = st.gas_regular.yoy_pct;
    return Object.keys(o).length ? o : undefined;
  }, [stateSel, states]);

  if (!data || !weights) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading component data…
      </div>
    );
  }

  const lastIdx = data.dates.length - 1;
  const mine = weightedYoY(data.components, weights, lastIdx, overrides);
  const diff = mine === null ? null : mine - gaugeYoy;

  const personalSeries = compareMonths.map((m) => {
    const di = data.dates.indexOf(m);
    return [m, di === -1 ? null : weightedYoY(data.components, weights, di)] as [
      string,
      number | null,
    ];
  });
  // contributions() substitutes 0 for missing component YoYs (reweight.ts is
  // spec-verbatim); weightedYoY() propagates null instead. Only compute and
  // render the drivers card when the personal rate itself is non-null, so the
  // card can never show numbers whose headline reads "—".
  const top =
    mine === null
      ? []
      : contributions(data.components, weights, lastIdx, overrides).slice(0, 5);
  const maxPp = Math.max(...top.map((t) => Math.abs(t.pp)), 0.01);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>📍 Your state</span>
        <select value={stateSel} onChange={(e) => setStateSel(e.target.value)}
          style={{ background: "var(--chip-bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px", fontSize: 13 }}>
          <option value="US">National (everyone)</option>
          {states.map((s) => <option key={s.state} value={s.state}>{s.name}</option>)}
        </select>
        {overrides && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {Object.keys(overrides).length} of 14 components localized ({Object.keys(overrides).join(", ")})
            {!overrides.fuel && " · gasoline pending — state history accrues ~2027"}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {ROWS.map((row) => (
          <div
            key={row.key}
            style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>
              {row.label}
            </span>
            <SegmentedControl
              options={row.options}
              value={answers[row.key]}
              // computed-key spread widens the field type to string — cast back
              onChange={(k) => setAnswers((a) => ({ ...a, [row.key]: k }) as Answers)}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          marginTop: 16,
          display: "flex",
          gap: 28,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Your inflation rate
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: "var(--accent-amber)", fontVariantNumeric: "tabular-nums" }}>
            {mine === null ? "—" : fmtPct(mine)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Macrogauge (everyone)
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--accent-sky)", fontVariantNumeric: "tabular-nums" }}>
            {fmtPct(gaugeYoy)}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>as of {gaugeAsOf}</div>
        </div>
        {diff !== null && (
          <div style={{ fontSize: 14 }}>
            Your basket is running{" "}
            <span
              style={{
                fontWeight: 700,
                color: diff > 0 ? "var(--accent-red)" : "var(--accent-emerald)",
              }}
            >
              {Math.abs(diff).toFixed(2)}pp {diff > 0 ? "hotter" : "cooler"}
            </span>{" "}
            than the average consumer&apos;s · as of {gaugeAsOf}
          </div>
        )}
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
        <EChart
          option={{
            ...baseOption(),
            series: [
              {
                name: "MY inflation",
                type: "line", showSymbol: false, lineStyle: { width: 1.5 },
                color: C.amber, data: personalSeries,
              },
              {
                name: "Macrogauge (everyone)",
                type: "line", showSymbol: false, lineStyle: { width: 1.5 },
                color: C.sky,
                data: compareMonths.map(
                  (m, i) => [m, compareGauge[i]] as [string, number | null]
                ),
              },
            ],
          }}
          height={340}
        />
      </div>

      {mine !== null && (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 16,
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
            What&apos;s driving your number
          </div>
          {top.map((t) => (
            <div
              key={t.code}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "4px 0", fontSize: 13 }}
            >
              <span style={{ minWidth: 140 }}>{t.label}</span>
              <span
                style={{
                  height: 6,
                  width: `${(Math.abs(t.pp) / maxPp) * 120}px`,
                  background: heatColor(t.yoyPct),
                  borderRadius: 3,
                }}
              />
              <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                {t.pp.toFixed(2)}pp · {t.weightPct.toFixed(0)}% of your basket at{" "}
                {t.yoyPct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, lineHeight: 1.6 }}>
        Method: the published basket weights are scaled by your answers, renormalized to
        100%, and applied to the same published component data behind the treemap
        (own-observation YoY — the gauge&apos;s own construction). Simple, transparent,
        and honest about being an approximation. Multipliers: {MULTIPLIER_NOTES.join(" · ")}.
        State localization swaps in your state&apos;s own electricity (and, once a year of
        history accrues, gasoline) inflation for the headline and drivers; the chart stays
        national.
      </div>
    </div>
  );
}
