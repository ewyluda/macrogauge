"use client";
import { useState } from "react";
import Link from "next/link";
import { useUrlState } from "@/lib/useUrlState";
import { codecs } from "@/lib/urlState";
import { C } from "@/lib/chartTheme";
import { fmtUsd } from "@/lib/format";
import { rebased, sinceRow, type MonthlySeries } from "@/lib/escalationSince";
import { CopyLink } from "./CopyLink";
import { LinesChart } from "./LinesChart";

const MAX_PICKS = 6;
// one validator for a typed amount and a shared link's `amount=`
const AMOUNT = codecs.float(1, 1e12);
const PALETTE = [C.sky, C.amber, C.emerald, C.violet, C.red, C.col];

const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;

export function EscalationSinceClient({
  series,
  defaultSince,
  defaultPicks,
}: {
  series: MonthlySeries[];
  defaultSince: string;
  defaultPicks: string[];
}) {
  const [since, setSince] = useUrlState("since", defaultSince, codecs.month());
  const [picksRaw, setPicksRaw] = useUrlState("series", defaultPicks.join(","), codecs.str(200));
  const [amount, setAmount] = useUrlState("amount", 1_000_000, AMOUNT);
  // what the box shows while it holds an invalid entry (null: the valid amount);
  // an invalid entry never reaches the URL or the results
  const [draft, setDraft] = useState<string | null>(null);
  const amountOk = draft == null;
  const onAmount = (v: string) => {
    const n = AMOUNT.parse(v.trim());
    if (n === undefined) {
      setDraft(v);
    } else {
      setAmount(n);
      setDraft(null);
    }
  };

  const known = new Set(series.map((s) => s.key));
  const picks = picksRaw.split(",").filter((k) => known.has(k)).slice(0, MAX_PICKS);
  const toggle = (key: string) =>
    setPicksRaw((picks.includes(key) ? picks.filter((k) => k !== key) : [...picks, key]).join(","));

  const chosen = series.filter((s) => picks.includes(s.key));
  const rows = chosen.map((s) => ({ s, row: sinceRow(s, since, amount) }));
  const lines = chosen.flatMap((s, i) => {
    const r = rebased(s, since);
    return r && r.months.length > 1
      ? [{ name: s.label, x: r.months.map((m) => `${m}-01`), y: r.values, color: PALETTE[i % PALETTE.length] }]
      : [];
  });
  const groups = [...new Set(series.map((s) => s.group))];
  const first = series.reduce((m, s) => (s.months[0] < m ? s.months[0] : m), "9999-12");
  const input: React.CSSProperties = {
    background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)",
    borderRadius: 6, padding: "8px 10px", fontVariantNumeric: "tabular-nums",
  };

  return (
    <div>
      <div className="calculator-controls calculator-controls-simple"
        style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16,
          display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Bid or NTP month{" "}
          <input type="month" value={since} min={first} onChange={(e) => setSince(e.target.value)} style={input} />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          Amount at that month ($){" "}
          <input type="number" min={1} max={1e12} value={draft ?? amount} onChange={(e) => onAmount(e.target.value)}
            aria-invalid={!amountOk} aria-describedby={amountOk ? undefined : "amount-invalid"}
            style={{ ...input, width: 130 }} />
        </label>
        {!amountOk && (
          <span id="amount-invalid" role="alert" data-testid="amount-invalid" style={{ fontSize: 12, color: "var(--accent-red)" }}>
            Enter an amount from $1 to $1 trillion.
          </span>
        )}
        <CopyLink />
      </div>

      <div className="since-picker" data-testid="since-picker">
        {groups.map((g) => (
          <fieldset key={g}>
            <legend>{g}</legend>
            {series.filter((s) => s.group === g).map((s) => {
              const on = picks.includes(s.key);
              return (
                <label key={s.key} title={s.source}>
                  <input type="checkbox" checked={on} disabled={!on && picks.length >= MAX_PICKS}
                    onChange={() => toggle(s.key)} /> {s.label}
                </label>
              );
            })}
          </fieldset>
        ))}
        <p className="method" style={{ margin: 0 }}>Pick up to {MAX_PICKS}.</p>
      </div>

      {!since || chosen.length === 0 ? (
        <p className="method" role="status" data-testid="since-empty">
          {!since ? `Pick a bid or NTP month (the earliest index starts ${first}).` : "Pick at least one index to compare."}
        </p>
      ) : (
        <>
          <div className="table-card">
            <table className="data-table" data-testid="since-table">
              <thead>
                <tr><th>Index</th><th>Since {since}</th><th>Annualized</th><th>{amountOk ? `${fmtUsd(amount)} becomes` : "Amount becomes"}</th><th>Through</th></tr>
              </thead>
              <tbody>
                {rows.map(({ s, row }) => row ? (
                  <tr key={s.key}>
                    <td>{s.label}<small style={{ display: "block", color: "var(--muted)" }}>{s.source}</small></td>
                    <td>{signed(row.changePct, 2)}</td>
                    <td>{row.annualizedPct != null ? `${signed(row.annualizedPct)}/yr` : row.months === 0 ? "no time elapsed" : "under a year"}</td>
                    <td>{amountOk ? fmtUsd(row.escalated) : "—"}</td>
                    <td>{row.lastMonth}</td>
                  </tr>
                ) : (
                  <tr key={s.key}>
                    <td>{s.label}<small style={{ display: "block", color: "var(--muted)" }}>{s.source}</small></td>
                    <td colSpan={4} style={{ color: "var(--muted)" }}>
                      No level for {since}: this series runs {s.months[0]} to {s.months[s.months.length - 1]}.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines.length > 0 && (
            <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
              <LinesChart height={320} recessions={false} yUnit="" fitY refLine={100} refLabel={`${since} = 100`}
                ariaTitle={`Chosen cost indexes rebased to 100 in ${since}`} series={lines} />
            </div>
          )}
        </>
      )}
      <p className="method">
        Each index is measured from its level in the bid month to its own latest print, so a PPI that publishes a month
        behind the DC index ends a month earlier; nothing is forward-filled. To carry a cost past the last print and see
        how often each contingency basis ran short, use <Link href="/escalation">Escalation</Link>; to settle a clause on
        one official series and a named vintage, use the <Link href="/escalation/clause">clause kit</Link>.
      </p>
    </div>
  );
}
