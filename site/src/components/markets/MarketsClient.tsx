"use client";
import { useMemo, useState } from "react";
import { fmtSpread, sortMarkets, tightness, type SortKey } from "@/lib/dcMarkets";
import type { DcMarkets, MarketCounty, MarketRow } from "@/lib/types";
import { ToneBadge, type Tone } from "@/components/ToneBadge";

// The six sortable columns (bound to dcMarkets.ts's SortKey union). Tightness
// is rendered as an extra, non-sortable column — tightness() buckets two
// spreads into one call and sortMarkets() has no key for that composite, so
// it isn't offered as a sort.
const SORT_COLS: [SortKey, string][] = [
  ["name", "Market"], ["wage", "Wage $/wk"], ["wageYoy", "Wage YoY"],
  ["emp", "Constr. workers"], ["empYoy", "Headcount YoY"], ["mw", "MW in flight"],
];

// Which basis each level column uses (dcmarkets.py's two-basis design):
// wage/wageYoy/empYoy stay on the like-for-like county set so the rate
// reconciles with its own base; emp (Constr. workers) is emp_cur_total, the
// market's true current size across every county with current-quarter data,
// independent of whether a county cleared last year's disclosure bar. Shown
// as a header tooltip; restated in the method paragraph and per-row in the
// expanded panel for readers who don't hover.
const COL_BASIS: Partial<Record<SortKey, string>> = {
  wage: "Like-for-like basis: counties present in both quarters.",
  wageYoy: "Like-for-like basis: counties present in both quarters.",
  emp: "Current-quarter basis: every county with current data, independent of last year's disclosure. Third-month (point-in-time) level — the wage above is weighted by each county's quarterly-average level instead, so the two don't share a denominator.",
  empYoy: "Like-for-like basis: counties present in both quarters.",
};

// One row per tightness() outcome, mapped to a ToneBadge tone + label. All
// four thresholds and the "na" (unavailable / no YoY basis) case live in
// dcMarkets.ts — this is presentation only.
const TIGHTNESS_STYLE: Record<ReturnType<typeof tightness>, [Tone, string]> = {
  hot: ["red", "Hot"],
  warm: ["amber", "Warm"],
  neutral: ["muted", "Neutral"],
  slack: ["emerald", "Slack"],
  na: ["muted", "—"],
};

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}%`;
}

function money(v: number | null): string {
  return v != null ? `$${v.toLocaleString()}` : "—";
}

export function MarketsClient({ data }: { data: DcMarkets }) {
  const [key, setKey] = useState<SortKey>("wageYoy");
  const [desc, setDesc] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(
    () => sortMarkets(data.markets, key, desc), [data.markets, key, desc]);

  const click = (k: SortKey) => {
    if (k === key) setDesc(!desc);
    else { setKey(k); setDesc(true); }
  };

  const th = (k: SortKey, label: string, title?: string) => (
    <th key={k} onClick={() => click(k)} style={{ cursor: "pointer" }} title={title}>
      {label}{key === k ? (desc ? " ▾" : " ▴") : ""}
    </th>
  );

  return (
    <div className="table-card">
      <table className="data-table">
        <thead>
          <tr>
            {th(...SORT_COLS[0])}
            <th>Tightness</th>
            {SORT_COLS.slice(1).map(([k, label]) => th(k, label, COL_BASIS[k]))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <Row key={m.key} m={m}
              open={open === m.key}
              onToggle={() => setOpen(open === m.key ? null : m.key)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 7 columns on screen: Market, Tightness, Wage, Wage YoY, Workers, Headcount
// YoY, MW. The unavailable branch's colSpan (6) and the expanded receipts
// row's colSpan (7) must track that count.
function Row({ m, open, onToggle }: { m: MarketRow; open: boolean; onToggle: () => void }) {
  if (!m.available) {
    return (
      <tr>
        <td>{m.name}</td>
        <td colSpan={6} style={{ color: "var(--muted)" }}>
          not available — BLS disclosure suppression
          {m.counties_suppressed.length
            ? ` (${m.counties_suppressed.join(", ")})` : ""}
          {m.note ? `: ${m.note}` : ""}
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr onClick={onToggle}
        role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        style={{ cursor: "pointer" }}>
        <td>
          {m.name}{m.thin_base ? " ⚠" : ""}
          {(m.counties_used < m.counties_total || m.yoy_basis === null) && (
            <span title="Partial county coverage this quarter — expand for the basis"> †</span>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {m.iso ?? m.grid ?? "—"} · {m.utility}
          </div>
        </td>
        <td><ToneBadge tone={TIGHTNESS_STYLE[tightness(m)][0]}>
          {TIGHTNESS_STYLE[tightness(m)][1]}
        </ToneBadge></td>
        <td>{money(m.wage)}</td>
        <td>{pct(m.wage_yoy_pct)} <small>{fmtSpread(m.wage_spread_pp)}</small></td>
        <td>{m.emp_cur_total != null ? m.emp_cur_total.toLocaleString() : "—"}</td>
        <td>{pct(m.emp_yoy_pct)} <small>{fmtSpread(m.emp_spread_pp)}</small></td>
        <td>
          {m.sites === 0
            ? "—"
            : m.mw_disclosed === 0
            ? "not disclosed"
            : `${m.mw_disclosed.toLocaleString()} MW`}
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {m.sites} tracked site{m.sites === 1 ? "" : "s"}
            {m.sites_mw_undisclosed
              ? ` · MW not disclosed at ${m.sites_mw_undisclosed} site${
                  m.sites_mw_undisclosed === 1 ? "" : "s"}`
              : ""}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7}>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 4px" }}>
              {m.note}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
              {m.yoy_basis === "like_for_like"
                ? `${m.counties_used} of ${m.counties_total} counties counted in both quarters (like-for-like basis — Wage $/wk, Wage YoY and Headcount YoY above).`
                : `${m.counties_used} of ${m.counties_total} counties counted in the current quarter only — no year-over-year basis available.`}
              {m.counties_suppressed.length
                ? m.yoy_basis === "like_for_like"
                  ? ` ${m.counties_suppressed.length} more excluded from that basis and from the receipts below (${m.counties_suppressed.join(", ")}); any current-quarter data they have is folded into the current-quarter total below, not broken out per county.`
                  : ` ${m.counties_suppressed.length} more (${m.counties_suppressed.join(", ")}) have no current-quarter data.`
                : ""}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
              Current-quarter total (the basis for Constr. workers above):{" "}
              {money(m.wage_cur)} wage ·{" "}
              {m.emp_cur_total != null ? m.emp_cur_total.toLocaleString() : "—"}{" "}
              workers, across every county with current-quarter data.
            </p>
            <table className="data-table">
              <thead>
                <tr><th>County FIPS</th><th>Wage</th><th>Wage YoY</th>
                  <th>Workers</th><th>Headcount YoY</th></tr>
              </thead>
              <tbody>
                {m.counties.map((c) => <CountyRow key={c.fips} c={c} />)}
                {m.counties_suppressed.map((fips) => (
                  <tr key={fips} style={{ color: "var(--muted)" }}>
                    <td>{fips}</td>
                    <td colSpan={4}>
                      {m.yoy_basis === "like_for_like"
                        ? "excluded from the like-for-like basis — see current-quarter total above"
                        : "no current-quarter data"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.thin_base && (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                ⚠ Thin base — under 1,500 construction workers. The rate is
                real but noisy; a single large project moves it.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CountyRow({ c }: { c: MarketCounty }) {
  return (
    <tr>
      <td>{c.fips}</td>
      <td>{money(c.wage)}</td>
      <td>{pct(c.wage_yoy_pct)}</td>
      <td>{c.emp != null ? c.emp.toLocaleString() : "—"}</td>
      <td>{pct(c.emp_yoy_pct)}</td>
    </tr>
  );
}
