"use client";
import { useState } from "react";
import { KpiCard } from "./KpiCard";
import { bridgeWindow, escalate, monthDiff, type BridgeComponent } from "@/lib/dcEscalation";
import {
  band,
  bases,
  lastCompleteMonth,
  MAX_HORIZON_MONTHS,
  MIN_HORIZON_MONTHS,
} from "@/lib/dcContingency";
import { fmtPp, fmtSigned } from "@/lib/format";

export type EscalationData = {
  months: string[];
  index: number[];
  componentIndex: Record<string, number[]>;
  components: BridgeComponent[];
  /** Per-component last_obs, for deriving the last COMPLETE month — the
   *  published grid's trailing month is a partial stub. */
  componentLastObs: string[];
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

/** "2026-06" + 48 -> "2030-06". Local to the UI's input cap. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function DcEscalationClient({ data }: { data: EscalationData }) {
  const firstMonth = data.months[0];
  const lastMonth = data.months[data.months.length - 1];
  const [baseMonth, setBaseMonth] = useState(
    data.months[Math.max(0, data.months.length - 25)]
  );
  const [baseCost, setBaseCost] = useState(9_000_000);

  const anchor = lastCompleteMonth(data.months, data.componentLastObs);
  // Cap the input at MAX_HORIZON_MONTHS past the month the forward leg actually
  // STARTS from (lastMonth, the grid end) — not past `anchor`. Anchoring the cap
  // on `anchor` would allow a 49-month carry whenever the grid carries a partial
  // trailing month, so the on-page "we cap at 48 months" claim would be false by
  // one. This is a deliberate one-month tightening of the spec's phrasing.
  const maxDelivery = addMonths(lastMonth, MAX_HORIZON_MONTHS);
  const [deliveryMonth, setDeliveryMonth] = useState("");
  const [basisKey, setBasisKey] = useState("trailing3y");

  const basisRows = anchor ? bases(data.months, data.index, anchor) : [];
  const chosen = basisRows.find((b) => b.key === basisKey) ?? basisRows[0] ?? null;

  const deliveryValid =
    !!deliveryMonth && !!anchor &&
    deliveryMonth > lastMonth && deliveryMonth <= maxDelivery;
  const horizon = deliveryValid ? monthDiff(lastMonth, deliveryMonth) : 0;

  const result = escalate(
    data.months, data.index, baseMonth, baseCost,
    deliveryValid && chosen
      ? { deliveryMonth, annualizedPct: chosen.annualizedPct }
      : null
  );

  const bandRow =
    deliveryValid && anchor && horizon >= MIN_HORIZON_MONTHS
      ? band(data.months, data.index, Math.min(horizon, MAX_HORIZON_MONTHS), anchor)
      : null;

  // Same computation as bandRow, but fixed at the cap itself rather than the
  // reader's chosen horizon. Backs the out-of-range message below with a live
  // independentDraws figure instead of a hardcoded crossover claim — the
  // horizon at which independent draws fall under 3 DRIFTS LATER every month
  // the sample grows (it is not 48; see the comment on MAX_HORIZON_MONTHS in
  // dcContingency.ts), so the message must not assert one.
  const capBand = anchor ? band(data.months, data.index, MAX_HORIZON_MONTHS, anchor) : null;

  const rows = bridgeWindow(
    data.months, data.componentIndex, data.components,
    baseMonth, lastMonth, baseCost
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
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          DELIVER BY{" "}
          <input
            type="month"
            min={lastMonth}
            max={maxDelivery}
            value={deliveryMonth}
            onChange={(e) => setDeliveryMonth(e.target.value)}
            style={input}
          />
        </label>
        {anchor && (
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            CARRY{" "}
            <select
              value={chosen?.key ?? ""}
              onChange={(e) => setBasisKey(e.target.value)}
              style={input}
              disabled={!deliveryValid}
            >
              {basisRows.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label} · {b.annualizedPct >= 0 ? "+" : ""}
                  {b.annualizedPct.toFixed(2)}%/yr
                </option>
              ))}
            </select>
          </label>
        )}
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

      {deliveryMonth && !deliveryValid && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          Pick a delivery month after {lastMonth} and no later than {maxDelivery}.
          We cap the forward leg at {MAX_HORIZON_MONTHS} months because the
          realized sample is already thin there
          {capBand ? ` (about ${capBand.independentDraws.toFixed(1)} independent windows)` : ""}{" "}
          and keeps thinning the longer the horizon runs. Forty-eight months still
          covers the 12–36 month range this tool targets, plus a mid-2026 base
          carried to a 2029–2030 energization.
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
              context={`${result.monthsElapsed} months · index ${result.baseIndex.toFixed(4)} → ${result.endIndex.toFixed(4)}`}
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
            {result.forward && chosen && (
              <KpiCard
                label={`Escalated to ${result.forward.deliveryMonth}`}
                value={usd(result.totalCost)}
                context={`${result.monthsElapsed}mo measured + ${result.forward.monthsAhead}mo carried at ${chosen.annualizedPct.toFixed(2)}%/yr (${chosen.label})`}
                accent="violet"
                chip={
                  bandRow ? (
                    <span
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "1px 5px",
                        fontSize: 11,
                      }}
                    >
                      p10–p90 {bandRow.p10.toFixed(1)}–{bandRow.p90.toFixed(1)}%/yr
                    </span>
                  ) : null
                }
              />
            )}
          </div>

          <div className="table-card" style={{ marginTop: 16 }}>
            <h2>
              What drove it{" "}
              <span className="subtitle">
                rows rounded to 2dp for display — compare TOTAL to Headline below
              </span>
            </h2>
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "0 12px 8px" }}>
              Contribution is priced against the headline&apos;s base index (the KPI card
              above) — not each component&apos;s own. So weight × &quot;Its own
              escalation&quot; will not reproduce Contribution, except where every component
              happens to start at 100 — the Index column below lets you verify Contribution
              directly: 100 × weight × (end − base) ÷ headline base index. That is a
              different formula from <code>contribution_pp</code> on{" "}
              <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a>{" "}
              (weight × the component&apos;s own YoY) — don&apos;t carry that shortcut over
              here.
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Weight</th>
                  <th>Its own escalation</th>
                  <th>Index (base → end)</th>
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
                      {r.componentBaseIndex.toFixed(4)} → {r.componentEndIndex.toFixed(4)}
                    </td>
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
                  <td>—</td>
                  <td>{fmtPp(displayedTotalPp)}</td>
                  <td>—</td>
                </tr>
                <tr style={{ color: "var(--muted)", background: "var(--bg)" }}>
                  <td>Headline</td>
                  <td>—</td>
                  <td>—</td>
                  <td>
                    {result.baseIndex.toFixed(4)} → {result.endIndex.toFixed(4)}
                  </td>
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

          {anchor && basisRows.length > 0 && (
            <div className="table-card" style={{ marginTop: 16 }}>
              <h2>
                What you could carry{" "}
                <span className="subtitle">
                  realized regimes, measured to {anchor} — not a forecast
                </span>
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Basis</th>
                    <th>Window</th>
                    <th>Annualized</th>
                    <th>Cumulative</th>
                    {deliveryValid && <th>Your {horizon}mo factor</th>}
                  </tr>
                </thead>
                <tbody>
                  {basisRows.map((b) => (
                    <tr
                      key={b.key}
                      style={
                        b.key === chosen?.key
                          ? { background: "var(--bg)", fontWeight: 600 }
                          : undefined
                      }
                    >
                      <td>
                        {b.label}
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.note}</div>
                      </td>
                      <td>
                        {b.startMonth} → {b.endMonth}{" "}
                        <span style={{ color: "var(--muted)" }}>({b.months}mo)</span>
                      </td>
                      <td>{fmtSigned(b.annualizedPct)}/yr</td>
                      <td>{fmtSigned(b.cumulativePct)}</td>
                      {deliveryValid && (
                        <td>
                          ×
                          {Math.pow(1 + b.annualizedPct / 100, horizon / 12).toFixed(4)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {bandRow && (
                <div
                  style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}
                >
                  Across every realized {bandRow.horizonMonths}-month window in the{" "}
                  {bandRow.sampleStartMonth}–{bandRow.sampleEndMonth} sample, annualized
                  DC Build escalation ran{" "}
                  <strong>
                    {bandRow.p10.toFixed(2)}% (p10) → {bandRow.p50.toFixed(2)}% (p50) →{" "}
                    {bandRow.p90.toFixed(2)}% (p90)
                  </strong>
                  . That is {bandRow.windows} overlapping windows —{" "}
                  <strong>≈{bandRow.independentDraws.toFixed(1)} independent</strong>{" "}
                  draws — and {bandRow.spikeOverlapPct.toFixed(0)}% of them touch the
                  2021–22 overlap window (narrower than the 2021–23 span the Peak-regime
                  basis above carries — the two are measured for different purposes). It
                  is a range of what has happened, not a probability distribution over
                  what will.
                </div>
              )}
              {!bandRow && deliveryValid && (
                <div
                  style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}
                >
                  No realized band here — it needs a window of at least{" "}
                  {MIN_HORIZON_MONTHS} months to compare like-length history, and your{" "}
                  {horizon}-month delivery window is shorter. The bases above still
                  apply — they&apos;re rates, not tied to any one window length — there
                  just isn&apos;t enough same-length history to bound them with a band.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
