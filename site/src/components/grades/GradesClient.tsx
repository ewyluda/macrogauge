"use client";

/** Renders dc_grades.json (site/public/data/dc_grades.json), the escalation
 *  grading harness behind /dc-scoreboard.
 *
 *  Two rules govern every section below and are not negotiable:
 *
 *   1. No shortfall figure appears without its counterpart leg -- table,
 *      prose, KPI tile. The strict leg's own withheld horizons (h36/h48)
 *      render WITHHELD_REASON, never a blank cell.
 *   2. The lead-lag verdict / weight_stable never render without the gate's
 *      caveats and conclusion in the same visual block -- a reader must not
 *      be able to screenshot the positive alone.
 *
 *  All math already happened in the pipeline (pipeline/engine/dcgrade.py).
 *  The only derivation here is picking argmin/argmax over numbers the
 *  artifact already published (the inversion, the weakest-draws horizon) --
 *  never a new statistic.
 */
import { Section } from "@/components/Section";
import { ToneBadge } from "@/components/ToneBadge";
import {
  BASIS_LABELS,
  HORIZONS,
  WITHHELD_REASON,
  formatPairedVerdict,
  horizonKey,
  pairedShortfall,
} from "@/lib/dcGrades";
import type { DcGrades, GradeStat, Leg } from "@/lib/types";

const BASIS_KEYS = Object.keys(BASIS_LABELS);

function pct(n: number | null | undefined, digits = 1): string {
  return n == null ? "—" : `${n.toFixed(digits)}%`;
}

function pp(n: number | null | undefined, digits = 2, signed = false): string {
  if (n == null) return "—";
  const s = signed && n > 0 ? "+" : "";
  return `${s}${n.toFixed(digits)}pp`;
}

// ---------------------------------------------------------------------------
// Paired grading table
// ---------------------------------------------------------------------------

type LegCellState =
  | { status: "graded"; stat: GradeStat }
  | { status: "withheld" }
  | { status: "not_gradeable" };

function legCellState(leg: Leg | undefined, basis: string, h: number): LegCellState {
  if (!leg) return { status: "not_gradeable" };
  if (!leg.published_horizons.includes(h)) return { status: "withheld" };
  const stat = leg.grades?.[basis]?.[horizonKey(h)];
  return stat == null ? { status: "not_gradeable" } : { status: "graded", stat };
}

type BasisAgg = { basis: string; meanMae: number; meanShortfall: number };

/** Mean MAE and mean shortfall per basis, over whichever horizons THIS leg
 *  actually publishes (leg.published_horizons) -- so the strict leg's mean is
 *  taken over h12/h24 only, never silently padded with horizons it withholds. */
function summarizeLeg(leg: Leg | undefined): BasisAgg[] | null {
  if (!leg) return null;
  const rows: BasisAgg[] = [];
  for (const basis of BASIS_KEYS) {
    const stats = leg.published_horizons
      .map((h) => leg.grades?.[basis]?.[horizonKey(h)])
      .filter((s): s is GradeStat => s != null);
    if (!stats.length) continue;
    rows.push({
      basis,
      meanMae: stats.reduce((a, s) => a + s.mae_pp, 0) / stats.length,
      meanShortfall: stats.reduce((a, s) => a + s.shortfall_rate_pct, 0) / stats.length,
    });
  }
  return rows.length ? rows : null;
}

function pickBestMae(rows: BasisAgg[]): BasisAgg {
  return rows.reduce((best, r) => (r.meanMae < best.meanMae ? r : best));
}

function pickWorstShortfall(rows: BasisAgg[]): BasisAgg {
  return rows.reduce((worst, r) => (r.meanShortfall > worst.meanShortfall ? r : worst));
}

/** Which of this leg's published horizons has the lowest mean independent-
 *  draw count, found live rather than assumed -- draws fall as horizon length
 *  grows (n / h, over roughly constant n), so the longest horizon is the
 *  weakest by construction, but which horizon that IS is read off the data,
 *  not hardcoded. */
function weakestHorizon(leg: Leg | undefined): { h: number; draws: number } | null {
  if (!leg) return null;
  let worst: { h: number; draws: number } | null = null;
  for (const h of leg.published_horizons) {
    const draws = BASIS_KEYS.map((b) => leg.grades?.[b]?.[horizonKey(h)]?.independent_draws).filter(
      (d): d is number => d != null,
    );
    if (!draws.length) continue;
    const mean = draws.reduce((a, d) => a + d, 0) / draws.length;
    if (!worst || mean < worst.draws) worst = { h, draws: mean };
  }
  return worst;
}

function LegCells({ cell }: { cell: LegCellState }) {
  if (cell.status === "withheld") {
    return (
      <td colSpan={3} style={{ textAlign: "left", color: "var(--muted)", fontStyle: "italic" }}>
        Withheld — {WITHHELD_REASON}
      </td>
    );
  }
  if (cell.status === "not_gradeable") {
    return (
      <td colSpan={3} style={{ textAlign: "left", color: "var(--muted)", fontStyle: "italic" }}>
        Not gradeable — no anchors reach this horizon
      </td>
    );
  }
  const s = cell.stat;
  return (
    <>
      <td>
        {pct(s.shortfall_rate_pct)}
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          mean {pp(s.mean_shortfall_pp)} · worst {pp(s.worst_shortfall_pp)}
        </div>
      </td>
      <td>
        {pp(s.bias_pp, 2, true)}
        <div style={{ fontSize: 11, color: "var(--muted)" }}>MAE {pp(s.mae_pp)}</div>
      </td>
      <td>{s.independent_draws.toFixed(1)}</td>
    </>
  );
}

function GradeRow({
  basis,
  h,
  strict,
  extended,
}: {
  basis: string;
  h: number;
  strict?: Leg;
  extended?: Leg;
}) {
  return (
    <tr>
      <td>{BASIS_LABELS[basis] ?? basis}</td>
      <td>{h}mo</td>
      <LegCells cell={legCellState(strict, basis, h)} />
      <LegCells cell={legCellState(extended, basis, h)} />
    </tr>
  );
}

function PairedGradingSection({ data, strict, extended }: { data: DcGrades; strict?: Leg; extended?: Leg }) {
  const weakestExt = weakestHorizon(extended);
  return (
    <Section title={`Paired grading: ${BASIS_KEYS.length} rules × ${HORIZONS.length} horizons`}>
      <p className="lede">{data.paired_legs_note}</p>
      <ul style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18, margin: "8px 0 16px" }}>
        {BASIS_KEYS.map((b) => (
          <li key={b}>{formatPairedVerdict(b, 12, pairedShortfall(data, b, 12))}</li>
        ))}
      </ul>
      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th rowSpan={2}>Basis</th>
              <th rowSpan={2}>Horizon</th>
              <th colSpan={3}>Strict — vintage-true{strict ? ` (${strict.anchors_n} anchors)` : ""}</th>
              <th colSpan={3}>Extended — final-revision{extended ? ` (${extended.anchors_n} anchors)` : ""}</th>
            </tr>
            <tr>
              <th>Shortfall</th>
              <th>Bias / MAE</th>
              <th>Draws</th>
              <th>Shortfall</th>
              <th>Bias / MAE</th>
              <th>Draws</th>
            </tr>
          </thead>
          <tbody>
            {BASIS_KEYS.flatMap((basis) =>
              HORIZONS.map((h) => (
                <GradeRow key={`${basis}-h${h}`} basis={basis} h={h} strict={strict} extended={extended} />
              )),
            )}
          </tbody>
        </table>
      </div>
      {weakestExt && (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
          Independent draws fall as the horizon lengthens — consecutive monthly anchors overlap, so a longer
          horizon compresses more history into fewer genuinely separate windows. On the extended sample, the{" "}
          {weakestExt.h}-month row is the thinnest, averaging {weakestExt.draws.toFixed(1)} independent draws
          across the three bases: read its shortfall rate as a wide range of precedent, not a precise probability.
        </p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The inversion
// ---------------------------------------------------------------------------

function findBasisRow(rows: BasisAgg[] | null, basis: string): BasisAgg | null {
  return rows?.find((r) => r.basis === basis) ?? null;
}

/** Names exactly ONE basis throughout (the lowest-mean-MAE basis on the
 *  primary sample) so that every shortfall figure quoted here is that same
 *  basis's own strict-vs-extended pair -- never a different basis's number
 *  quoted from a single leg. Rank comparisons ("the highest of the three")
 *  are stated without printing another basis's figure, which is how the
 *  paired-legs rule stays intact even when discussing relative standing. */
function InversionSection({ strict, extended }: { strict?: Leg; extended?: Leg }) {
  const strictAgg = summarizeLeg(strict);
  const extendedAgg = summarizeLeg(extended);
  if (!strictAgg && !extendedAgg) return null;

  const primaryAgg = strictAgg ?? extendedAgg!;
  const primaryIsStrict = !!strictAgg;
  const bm = pickBestMae(primaryAgg);

  const strictRow = findBasisRow(strictAgg, bm.basis);
  const extendedRow = findBasisRow(extendedAgg, bm.basis);
  const strictWorstBasis = strictAgg ? pickWorstShortfall(strictAgg).basis : null;
  const extWorstBasis = extendedAgg ? pickWorstShortfall(extendedAgg).basis : null;

  return (
    <Section title="The inversion">
      <p className="lede">
        Of the three rolling bases, <b>{BASIS_LABELS[bm.basis]}</b> has the lowest mean absolute error{" "}
        {strictRow && extendedRow ? (
          <>
            on both samples — {pp(strictRow.meanMae)} on the strict, vintage-true sample and {pp(extendedRow.meanMae)}{" "}
            on the extended sample.
          </>
        ) : (
          <>on the {primaryIsStrict ? "strict, vintage-true" : "extended"} sample ({pp(bm.meanMae)}).</>
        )}{" "}
        That is also the basis most likely to leave a reader short — a symmetric error metric rewards centering the
        error, not skewing it toward safety.{" "}
        {strictRow && (
          <>
            Its mean shortfall rate on the strict sample is {pct(strictRow.meanShortfall)}
            {strictWorstBasis === bm.basis ? ", the highest of the three rolling bases there." : "."}
          </>
        )}{" "}
        {extendedRow && (
          <>
            On the extended sample — deeper, and the one that actually contains a downturn — its mean shortfall
            rate is {pct(extendedRow.meanShortfall)},{" "}
            {extWorstBasis === bm.basis
              ? "still the highest of the three: the inversion holds even once the sample includes a period escalation actually cooled."
              : "no longer the highest of the three (a different basis now is): the inversion attenuates once the sample includes a period escalation actually cooled."}
          </>
        )}
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Scenarios (hindsight-selected, ungradeable)
// ---------------------------------------------------------------------------

function ScenarioSection({ scenarios }: { scenarios: DcGrades["scenarios"] }) {
  if (!scenarios.length) return null;
  return (
    <Section title="Regimes carried on /escalation — ungradeable by design">
      <div className="section-featured" style={{ marginTop: 0 }}>
        <p className="lede" style={{ margin: 0 }}>
          /escalation also lets a reader carry either of these hand-picked historical regimes instead of a
          rolling rule. Both windows were chosen with hindsight, after the fact, from realized history — so
          neither is graded above or anywhere else on this page. They publish a rate and a window only: no
          shortfall rate, no MAE, no independent-draw count. Computing one would score hindsight against itself.
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14 }}>
          {scenarios.map((s) => (
            <div
              key={s.key}
              style={{
                flex: "1 1 260px",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 16,
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
                {s.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, margin: "4px 0", fontVariantNumeric: "tabular-nums" }}>
                {s.annualized_pct != null ? `${s.annualized_pct > 0 ? "+" : ""}${s.annualized_pct}%` : "—"}
                <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}> annualized</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {s.start_month} – {s.end_month}
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>{s.note}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Lead-lag
// ---------------------------------------------------------------------------

function LeadLagSection({ leadlag }: { leadlag: DcGrades["leadlag"] }) {
  return (
    <Section title="Lead-lag: do input-price moves forecast the index?">
      {!leadlag ? (
        <p className="lede">Lead-lag study unavailable in this publish.</p>
      ) : (
        <>
          {/* Verdict, gate, caveats and conclusion live in ONE bordered block,
              never split across a fold or a collapsed disclosure -- a reader
              cannot screenshot the verdict without the caveats landing in the
              same shot. */}
          <div className="section-featured" style={{ marginTop: 0 }}>
            <p style={{ margin: 0 }}>
              <b>Verdict:</b> {leadlag.verdict}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0" }}>
              <b>Gate:</b> {leadlag.gate}
            </p>
            <ul style={{ fontSize: 13, lineHeight: 1.55, paddingLeft: 18, margin: "8px 0" }}>
              {leadlag.caveats.map((c) => (
                <li key={c.key} style={{ marginBottom: 6 }}>
                  {c.text}
                </li>
              ))}
            </ul>
            <p style={{ margin: "8px 0 0" }}>
              <b>Conclusion:</b> {leadlag.conclusion}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
              {(leadlag.weight_covered * 100).toFixed(0)}% of Build weight has a mapped input-price driver;{" "}
              {(leadlag.weight_stable * 100).toFixed(0)}% of that weight cleared the pre-registered gate above —
              read the caveats before treating that as a usable lead.
            </p>
          </div>
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Component</th>
                  <th>Weight</th>
                  <th>Best lag</th>
                  <th>Correlation</th>
                  <th>Split-half lag (1st → 2nd)</th>
                  <th>Gate</th>
                </tr>
              </thead>
              <tbody>
                {leadlag.mappings.map((m) => (
                  <tr key={`${m.driver}-${m.component}`}>
                    <td>{m.driver_label}</td>
                    <td>{m.component_label}</td>
                    <td>{(m.weight * 100).toFixed(0)}%</td>
                    <td>{m.best_lag_months != null ? `${m.best_lag_months}mo` : "—"}</td>
                    <td>{m.best_correlation != null ? m.best_correlation.toFixed(3) : "—"}</td>
                    <td>
                      {m.first_half.best_lag_months != null ? `${m.first_half.best_lag_months}mo` : "—"}
                      {" → "}
                      {m.second_half.best_lag_months != null ? `${m.second_half.best_lag_months}mo` : "—"}
                    </td>
                    <td>
                      <ToneBadge tone={m.stable ? "emerald" : "muted"}>
                        {m.stable ? "Cleared" : "Not stable"}
                      </ToneBadge>
                      {m.stable && (
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, textAlign: "left" }}>
                          {m.best_lag_months === 0
                            ? "0-month lag — contemporaneous, not a lead (see caveats above)"
                            : "see caveats above before treating this as forecasting evidence"}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Power nowcast
// ---------------------------------------------------------------------------

function PowerNowcastSection({ nowcast }: { nowcast: DcGrades["power_nowcast"] }) {
  return (
    <Section title="Power nowcast: a fast read vs. the slow retail print">
      {!nowcast ? (
        <p className="lede">Power nowcast unavailable in this publish.</p>
      ) : (
        <div className="table-card" style={{ padding: 16 }}>
          <p style={{ margin: 0 }}>
            <b>{nowcast.verdict}</b> — a like-month year-ratio nowcast, backtested over {nowcast.months_graded}{" "}
            months of realized retail prints (as of {nowcast.as_of ?? "—"}): best nowcast MAE{" "}
            {nowcast.best_mae != null ? nowcast.best_mae.toFixed(3) : "—"}pp
            {nowcast.best_lambda != null ? ` (λ=${nowcast.best_lambda})` : ""} vs. carry-forward MAE{" "}
            {nowcast.carry_forward_mae != null ? nowcast.carry_forward_mae.toFixed(3) : "—"}pp.
          </p>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>{nowcast.note}</p>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

function MethodologySection({ data, strict, extended }: { data: DcGrades; strict?: Leg; extended?: Leg }) {
  return (
    <Section title="Methodology">
      <p className="method">
        Both legs price the DC Build index off ALFRED point-in-time vintages.{" "}
        {strict ? <>The strict leg is {strict.provenance}. </> : null}
        Its anchors cannot start before <b>{strict?.span?.[0] ?? "—"}</b>: the index is based to that month, and an
        index based at its own base month cannot be reconstructed at a vintage that predates the base observation
        itself — a principled floor, not a data gap. Grading at a different base month would also grade a
        materially different index: this is a Laspeyres sum of separately rebased components, so its effective
        per-component weight is <code>weight ÷ index-at-base</code>, and that base constant does not cancel out of
        a weighted sum the way it would for a single series.
      </p>
      <p className="method">
        {extended ? (
          <>
            The extended leg is {extended.provenance}, reaching back to <b>{extended.span?.[0] ?? "—"}</b>.{" "}
          </>
        ) : null}
        Substituting final-revision data for a real-time read understates how much a reader actually knew at the
        time — measured across nine historical anchors, at most <b>{data.revision_disclosure_pp}pp</b> of
        distortion in the annualized rate. That is small enough that the deeper sample publishes alongside the
        strict one rather than being withheld outright, with the distortion disclosed here rather than hidden.
      </p>
      <p className="method">
        Anchors dedupe by last-observation month: several ALFRED vintages can share one, when a release revises an
        old observation without extending the series. Grading every vintage would inflate both the anchor count and
        the independent-draw estimate without adding information, so each leg carries exactly one anchor per
        distinct last-observation month — the earliest vintage to reach it, since that is the first date a reader
        could actually have stood there.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function GradesClient({ data }: { data: DcGrades }) {
  const strict = data.legs?.strict;
  const extended = data.legs?.extended;

  return (
    <>
      <PairedGradingSection data={data} strict={strict} extended={extended} />
      <InversionSection strict={strict} extended={extended} />
      <ScenarioSection scenarios={data.scenarios} />
      <LeadLagSection leadlag={data.leadlag} />
      <PowerNowcastSection nowcast={data.power_nowcast} />
      <MethodologySection data={data} strict={strict} extended={extended} />
    </>
  );
}
