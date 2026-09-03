"use client";
import { useUrlState } from "@/lib/useUrlState";
import { codecs } from "@/lib/urlState";
import { CopyLink } from "./CopyLink";
import { CarryTable } from "./CarryTable";
import { checkMonth } from "@/lib/monthInput";
import type { EscalationData } from "@/lib/escalationData";
import { KpiCard } from "./KpiCard";
import {
  addMonths,
  bridgeWindow,
  escalate,
  monthDiff,
  type BridgeComponent,
} from "@/lib/dcEscalation";
import {
  band,
  bases,
  lastCompleteMonth,
  MAX_HORIZON_MONTHS,
  MIN_HORIZON_MONTHS,
} from "@/lib/dcContingency";
import {
  ESCALATION_BASIS_TO_GRADE as GRADE_BASIS_KEY,
  formatPairedVerdict,
  pairedShortfall,
  type GradeLegs,
} from "@/lib/dcGrades";
import { fmtPp, fmtSigned, fmtUsd } from "@/lib/format";

export type { EscalationData };

const usd = fmtUsd;

export function DcEscalationClient({
  data,
  grades,
}: {
  data: EscalationData;
  // The legs slice of dc_grades.json, never the whole artifact — see
  // escalationGradeSlice() and this page's server component.
  grades: GradeLegs | null;
}) {
  const firstMonth = data.months[0];
  const lastMonth = data.months[data.months.length - 1];
  const [baseMonth, setBaseMonth] = useUrlState(
    "base", data.months[Math.max(0, data.months.length - 25)], codecs.month()
  );
  const [baseCost, setBaseCost] = useUrlState("cost", 9_000_000, codecs.float(0, 1e12));

  const anchor = lastCompleteMonth(data.months, data.componentLastObs);
  // Cap the input at MAX_HORIZON_MONTHS past the month the forward leg actually
  // STARTS from (lastMonth, the grid end) — not past `anchor`. Anchoring the cap
  // on `anchor` would allow a 49-month carry whenever the grid carries a partial
  // trailing month, so the on-page "we cap at 48 months" claim would be false by
  // one. This is a deliberate one-month tightening of the spec's phrasing.
  const maxDelivery = addMonths(lastMonth, MAX_HORIZON_MONTHS);
  // The smallest delivery month that produces a forward leg at all. `lastMonth`
  // itself is NOT valid — deliveryValid requires a strictly later month, since
  // delivering in the month history already ends in carries nothing — so the
  // picker's own minimum must be the month after it. Offering `lastMonth` as the
  // min let the native picker propose a value the page then rejected.
  const minDelivery = addMonths(lastMonth, 1);
  const [deliveryMonth, setDeliveryMonth] = useUrlState("delivery", "", codecs.month());
  const [basisKey, setBasisKey] = useUrlState("basis", "trailing3y", codecs.str(30));

  const basisRows = anchor ? bases(data.months, data.index, anchor) : [];
  const chosen = basisRows.find((b) => b.key === basisKey) ?? basisRows[0] ?? null;
  // `?? null` collapses "key absent from the map" and "key maps to null"
  // (gfc/covid) into the same value on purpose — GRADE_BASIS_KEY is total
  // over every key `chosen.key` can hold, so the two cases can't actually
  // diverge; this just keeps the lookup itself total against a wider type.
  const gradeBasisKey = chosen ? GRADE_BASIS_KEY[chosen.key] ?? null : null;

  // Validate the typed strings, not just the native picker's min/max: Safari
  // renders <input type="month"> as free text and ignores both (todo #20).
  const baseCheck = checkMonth(baseMonth, firstMonth, lastMonth, "base month");
  const deliveryCheck = deliveryMonth ? checkMonth(deliveryMonth, minDelivery, maxDelivery, "delivery month") : null;
  const deliveryValid = !!deliveryCheck && deliveryCheck.ok && !!anchor;
  const horizon = deliveryValid ? monthDiff(lastMonth, deliveryMonth) : 0;

  const result = baseCheck.ok ? escalate(
    data.months, data.index, baseMonth, baseCost,
    deliveryValid && chosen
      ? { deliveryMonth, annualizedPct: chosen.annualizedPct }
      : null
  ) : null;

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
            min={minDelivery}
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
        <CopyLink />
      </div>

      {grades && deliveryValid && chosen && (
        <p
          data-testid="basis-grade"
          style={{ color: "var(--muted)", fontSize: 12, padding: "8px 4px 0" }}
        >
          {gradeBasisKey ? (
            <>
              {formatPairedVerdict(
                gradeBasisKey,
                horizon,
                pairedShortfall(grades, gradeBasisKey, horizon)
              )}{" "}
              {/* The grading harness reconstructs this index from official
                  releases only, with no live futures tail — so the rate it
                  grades and the rate shown above can differ slightly in the
                  months where that tail is spliced in. A one-clause flag
                  here, with the measured gap on /dc-scoreboard's methodology,
                  rather than either a silent difference or a paragraph of
                  arithmetic inside a one-line verdict. */}
              Graded on a reconstruction from official prints only, which can differ
              slightly in months carrying a live futures tail.{" "}
              <a href="/dc-scoreboard" style={{ color: "var(--accent-sky)" }}>
                See how each basis has held up →
              </a>
            </>
          ) : (
            <>
              This is a hindsight-selected historical episode, not a rule — it
              carries no grade.{" "}
              <a href="/dc-scoreboard" style={{ color: "var(--accent-sky)" }}>
                See the bases that do →
              </a>
            </>
          )}
        </p>
      )}

      {!baseCheck.ok && (
        <div data-testid="base-month-error" style={{ color: "var(--accent-amber)", fontSize: 13, padding: 24 }}>
          {baseCheck.message}
        </div>
      )}
      {baseCheck.ok && !result && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          The index starts in {firstMonth}. Pick a later base month.
        </div>
      )}

      {result && !validBaseCost && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          Enter a base cost greater than $0 to see the escalation.
        </div>
      )}

      {deliveryCheck && !deliveryCheck.ok && deliveryCheck.reason === "format" && (
        <div data-testid="delivery-month-error" style={{ color: "var(--accent-amber)", fontSize: 13, padding: 24 }}>
          {deliveryCheck.message}
        </div>
      )}
      {deliveryCheck && !deliveryCheck.ok && deliveryCheck.reason !== "format" && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          Pick a delivery month between {minDelivery} and {maxDelivery}. We cap the
          forward leg at {MAX_HORIZON_MONTHS} months because the realized sample is
          already thin there
          {capBand ? ` (about ${capBand.independentDraws.toFixed(1)} independent windows)` : ""}{" "}
          and keeps thinning the longer the horizon runs. That still spans the 12–36
          month range this tool targets, and carries a basis measured to{" "}
          {anchor ?? lastMonth} as far out as {maxDelivery}.
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

          {anchor && (
            <CarryTable basisRows={basisRows} chosenKey={chosen?.key ?? null} deliveryValid={deliveryValid}
              horizon={horizon} bandRow={bandRow} anchor={anchor} />
          )}
        </>
      )}
    </div>
  );
}
