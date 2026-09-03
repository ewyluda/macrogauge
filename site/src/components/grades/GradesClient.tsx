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
 *  Nearly all math already happened in the pipeline
 *  (pipeline/engine/dcgrade.py); this file mostly picks argmin/argmax over
 *  numbers the artifact already published (the inversion, the weakest-draws
 *  horizon).
 *
 *  ONE class of figure is computed here and appears nowhere in
 *  dc_grades.json: the per-basis MEAN MAE and MEAN SHORTFALL across
 *  horizons, in the inversion section. They are page-level aggregates —
 *  plain unweighted averages of the per-horizon figures the artifact
 *  publishes and the table above them renders — taken over the horizons BOTH
 *  legs publish, which the section names on the page. A reader can reproduce
 *  either by averaging the cells directly above. `pairedBasisMeans()` in
 *  lib/dcGrades.ts is the only supported way to take them; see its docstring
 *  for why aggregating each leg over its own horizon set is wrong.
 */
import { Section } from "@/components/Section";
import { ToneBadge } from "@/components/ToneBadge";
import {
  BASIS_LABELS,
  HORIZONS,
  WITHHELD_REASON,
  formatHorizonList,
  formatPairedVerdict,
  horizonKey,
  maeClaim,
  pairedBasisMeans,
  pairedShortfall,
  pickBestMae,
  pickWorstShortfall,
  type LegPick,
  type PairedBasisMeans,
} from "@/lib/dcGrades";
import type { DcGrades, DcGradesAnchor, GradeStat, Leg } from "@/lib/types";
import { AnchorScatter } from "./AnchorScatter";
import { LeadLagProfile } from "./LeadLagProfile";

/** Everything /dc-scoreboard renders, minus the `anchors` receipts it does
 *  not read. The full artifact remains available to the server page for its
 *  reconstruction check and through the methodology download link. */
export type GradesPageData = Omit<DcGrades, "anchors">;

/** The graded reconstruction vs. the published index, measured live on the
 *  server from the two artifacts (dc_grades.json + datacenter.json) — see
 *  MethodologySection and the page component. */
export type ReconstructionNote = {
  month: string;
  proxyLabels: string[];
  proxyWeightPct: number;
  /** The rolling basis where the two indexes disagree most at `month`. */
  worst: { basis: string; graded: number; published: number } | null;
};

const BASIS_KEYS = Object.keys(BASIS_LABELS);

// ALFRED's raw release history for the 12 DC Build components reaches back to
// 2015-03 (pipeline/engine/dcgrade.py's module docstring, backing
// scripts/backfill_dc_vintages.py). This is a fixed property of the upstream
// source -- not a per-publish measurement -- so it is a deliberate literal
// rather than a read off dc_grades.json: the artifact has no field for it,
// and it will not change on a future publish the way a shortfall rate or
// anchor count would. (The revision-disclosure figure below is the opposite
// case -- measured fresh each publish -- and reads off the artifact.) Named
// here (never inlined) so a change to the upstream backfill only needs one
// edit.
const ALFRED_RAW_HISTORY_START = "2015-03";

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

/** Whether a leg's anchor span includes a realized downturn — a sample
 *  with none cannot tell a reader what a long window looks like in one
 *  (the 2018-start lesson in the design spec). Published per leg. */
function DownturnBadge({ leg }: { leg?: Leg }) {
  if (!leg) return null;
  return (
    <ToneBadge tone={leg.contains_downturn ? "emerald" : "amber"}>
      {leg.contains_downturn ? "includes a downturn" : "no downturn in sample"}
    </ToneBadge>
  );
}

function PairedGradingSection({
  data,
  strict,
  extended,
}: {
  data: GradesPageData;
  strict?: Leg;
  extended?: Leg;
}) {
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
              <th colSpan={3}>Strict — vintage-true{strict ? ` (${strict.anchors_n} anchors)` : ""} <DownturnBadge leg={strict} /></th>
              <th colSpan={3}>Extended — final-revision{extended ? ` (${extended.anchors_n} anchors)` : ""} <DownturnBadge leg={extended} /></th>
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

/** Names exactly ONE basis throughout (the lowest-mean-MAE basis on the
 *  primary sample) so that every shortfall figure quoted here is that same
 *  basis's own strict-vs-extended pair -- never a different basis's number
 *  quoted from a single leg. Rank comparisons ("the highest of the three")
 *  are stated without printing another basis's figure, which is how the
 *  paired-legs rule stays intact even when discussing relative standing.
 *
 *  Every RANKING here is computed on the leg it is claimed for -- the
 *  best-MAE pick per leg, the worst-shortfall pick per leg -- and a claim
 *  spans both samples only when both legs' own picks agree. This paragraph
 *  once derived "lowest error on both samples" and "most likely to leave a
 *  reader short" from the strict leg's pick alone; both held on the data of
 *  the day, but neither had been computed on the leg it spoke for.
 *
 *  Every mean below comes from pairedBasisMeans(), i.e. BOTH legs averaged
 *  over the SAME horizons (the intersection of what they publish), and the
 *  paragraph names that horizon set. Aggregating each leg over its own
 *  published horizons instead would print the strict leg's h12/h24 mean
 *  beside the extended leg's h12/h24/h36/h48 mean as though the two were
 *  comparable, understating exactly the spread this section is about. */
function InversionSection({ data }: { data: GradesPageData }) {
  const rows = pairedBasisMeans(data);
  if (!rows.length) return null;

  const strictOf: LegPick = (r) => r.strict;
  const extendedOf: LegPick = (r) => r.extended;
  const hasStrict = rows.some((r) => r.strict);
  const hasExtended = rows.some((r) => r.extended);

  const bmStrict = hasStrict ? pickBestMae(rows, strictOf) : null;
  const bmExtended = hasExtended ? pickBestMae(rows, extendedOf) : null;
  const bm = bmStrict ?? bmExtended;
  const claim = maeClaim(bmStrict, bmExtended);
  if (!bm || !claim) return null;

  const strictRow = bm.strict;
  const extendedRow = bm.extended;
  const strictWorst = hasStrict ? pickWorstShortfall(rows, strictOf) : null;
  const extWorst = hasExtended ? pickWorstShortfall(rows, extendedOf) : null;
  const shortOnStrict = strictWorst?.basis === bm.basis;
  const shortOnExtended = extWorst?.basis === bm.basis;
  const horizons = formatHorizonList(bm.horizons);

  return (
    <Section title="The inversion">
      <p className="lede">
        Of the three rolling bases, <b>{BASIS_LABELS[bm.basis]}</b> has the lowest mean absolute error{" "}
        {claim.scope === "both" && strictRow && extendedRow ? (
          <>
            on both samples — {pp(strictRow.meanMae)} on the strict, vintage-true sample and {pp(extendedRow.meanMae)}{" "}
            on the extended sample.
          </>
        ) : claim.scope === "primary_only" ? (
          <>
            on the strict, vintage-true sample ({pp(strictRow?.meanMae)}) — though not on the extended sample,
            where {BASIS_LABELS[claim.otherBasis]} takes the lowest error instead.
          </>
        ) : (
          <>
            on the {hasStrict ? "strict, vintage-true" : "extended"} sample ({pp((hasStrict ? strictRow : extendedRow)?.meanMae)}).
          </>
        )}{" "}
        {strictRow && (
          <>
            {shortOnStrict ? (
              <>
                On the strict sample it is also the basis most likely to leave a reader short — a symmetric error
                metric rewards centering the error, not skewing it toward safety: its mean shortfall rate there is{" "}
                {pct(strictRow.meanShortfall)}, the highest of the three rolling bases.
              </>
            ) : (
              <>Its mean shortfall rate on the strict sample is {pct(strictRow.meanShortfall)} — not the highest of the three there.</>
            )}
          </>
        )}{" "}
        {extendedRow && (
          <>
            On the extended sample — deeper, and the one that actually contains a downturn — its mean shortfall
            rate is {pct(extendedRow.meanShortfall)},{" "}
            {shortOnExtended
              ? shortOnStrict
                ? "still the highest of the three: the inversion holds even once the sample includes a period escalation actually cooled."
                : "the highest of the three there."
              : shortOnStrict
                ? "no longer the highest of the three (a different basis now is): the inversion attenuates once the sample includes a period escalation actually cooled."
                : "not the highest of the three there."}
          </>
        )}
      </p>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
        Every mean in this section covers the {horizons} horizons — the horizons{" "}
        {hasStrict && hasExtended ? "both legs publish" : "this leg publishes"}, and the only ones on which the two
        samples can be compared like for like (the strict leg withholds the longer ones as too thin). They are plain
        averages of the per-horizon figures in the table above, taken over that same set for each leg, so a reader can
        re-derive them from those cells by hand.
        {hasStrict && hasExtended && bm.horizons.length < HORIZONS.length ? (
          <>
            {" "}
            The extended leg&apos;s longer horizons are graded in that table and deliberately left out of these means:
            averaging them in on one side only would flatter whichever leg reaches further.
          </>
        ) : null}
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
            {/* Both shares are of BUILD WEIGHT — the same denominator — and
                say so explicitly. `weight_stable` is NOT a share of
                `weight_covered`: reading "12% of that weight" as 12% of the
                mapped 45% gives 5.4%, understating the cleared share by a
                factor of ~2.2. The share-of-mapped ratio is stated too, but
                DERIVED from the two published weights rather than written
                down. */}
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
              {(leadlag.weight_covered * 100).toFixed(0)}% of Build weight has a mapped input-price driver;{" "}
              {(leadlag.weight_stable * 100).toFixed(0)}% of Build weight cleared the pre-registered gate above
              {leadlag.weight_covered > 0
                ? ` (${((leadlag.weight_stable / leadlag.weight_covered) * 100).toFixed(0)}% of the mapped set)`
                : ""}{" "}
              — read the caveats before treating that as a usable lead.
            </p>
          </div>
          <LeadLagProfile mappings={leadlag.mappings} />
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Component</th>
                  <th>Weight</th>
                  {/* The live sample behind every correlation in the row. The
                      split-artifact caveat above talks about sample DEPTH
                      moving the midpoint; without this column a reader has no
                      way to see what depth this run actually ran on. */}
                  <th>Sample</th>
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
                    <td>
                      {m.months} mo
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {m.span?.[0] ?? "—"} – {m.span?.[1] ?? "—"}
                      </div>
                    </td>
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
          {nowcast.dropped_months.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
              {nowcast.dropped_months.length} month{nowcast.dropped_months.length === 1 ? "" : "s"} graded by at
              least one candidate ({nowcast.dropped_months.join(", ")}) fell outside the common comparison set —
              a pass-through level's sign guard could not grade {nowcast.dropped_months.length === 1 ? "it" : "them"} —
              and {nowcast.dropped_months.length === 1 ? "is" : "are"} excluded from every MAE above, so the
              three-way comparison stays apples-to-apples.
            </p>
          )}
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>{nowcast.note}</p>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

function MethodologySection({
  data,
  strict,
  extended,
  reconstruction,
  anchorsN,
}: {
  data: GradesPageData;
  strict?: Leg;
  extended?: Leg;
  reconstruction: ReconstructionNote | null;
  anchorsN: number;
}) {
  return (
    <Section title="Methodology">
      <p className="method">
        Both legs price the DC Build index off ALFRED point-in-time vintages, whose raw release history for these
        twelve components reaches back to <b>{ALFRED_RAW_HISTORY_START}</b>.{" "}
        {strict ? <>The strict leg is {strict.provenance}, </> : null}
        but its anchors cannot start before <b>{strict?.span?.[0] ?? "—"}</b> regardless — a second, additional
        floor on top of that raw history, not a sign the underlying data runs out there: the index is based to
        that month, and an index based at its own base month cannot be reconstructed at a vintage that predates
        the base observation itself, however far back the raw releases go. So the strict leg's start is a
        conceptual constraint, not a data accident. Grading at a different base month would also grade a
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
        time
        {data.revision_disclosure_pp != null ? (
          <>
            {" "}
            — measured on this publish across every anchor month the two legs share, at most{" "}
            <b>{data.revision_disclosure_pp}pp</b> of distortion in a carried annualized rate, a figure re-derivable
            from the anchor rows in the raw artifact linked below. The deeper sample therefore publishes alongside
            the strict one rather than replacing it, with the distortion disclosed here rather than hidden.
          </>
        ) : (
          <>
            ; on this publish the two legs shared no anchor month to measure that distortion against, so no bound
            is claimed.
          </>
        )}
      </p>
      <p className="method">
        Anchors dedupe by last-observation month: several ALFRED vintages can share one, when a release revises an
        old observation without extending the series. Grading every vintage would inflate both the anchor count and
        the independent-draw estimate without adding information, so each leg carries exactly one anchor per
        distinct last-observation month — the earliest vintage to reach it, since that is the first date a reader
        could actually have stood there.
      </p>
      {reconstruction && (
        <p className="method">
          <b>The index graded here is reconstructed from official releases only.</b> Every component is read from its
          published PPI/CES series and nothing else. The DC Build index on{" "}
          <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a> and{" "}
          <a href="/escalation" style={{ color: "var(--accent-sky)" }}>/escalation</a> additionally splices a live
          futures tail onto {reconstruction.proxyLabels.join(" and ")} ({reconstruction.proxyWeightPct.toFixed(1)}% of
          Build weight) past their last official print, so the two indexes agree in every month where that splice is
          inactive and differ where it is not — and the latest anchor, the month every basis above is read at, is such
          a month.
          {reconstruction.worst ? (
            <>
              {" "}
              Measured at {reconstruction.month}, the widest gap is{" "}
              {BASIS_LABELS[reconstruction.worst.basis] ?? reconstruction.worst.basis}, which grades here at{" "}
              {reconstruction.worst.graded.toFixed(2)}%/yr against the {reconstruction.worst.published.toFixed(2)}%/yr
              /escalation shows for the same rule.
            </>
          ) : null}{" "}
          The statistics above are barely touched — only the handful of anchor-horizon pairs whose anchor falls in a
          splice month can differ at all — but the two numbers are not identical, and this page says so rather than
          leaving a reader to find it.
        </p>
      )}
      <p className="method">
        <b>Receipts.</b> Every figure on this page is re-derivable from the published artifact:{" "}
        <a href="/data/dc_grades.json" style={{ color: "var(--accent-sky)" }}>
          /data/dc_grades.json
        </a>{" "}
        carries all {anchorsN} anchor rows — for each anchor month and leg, what every basis said to carry and what
        escalation actually did over each horizon next. The array is deliberately not rendered here (it is a
        re-derivation dataset, not a reading experience) and deliberately not serialized into this page either; it is
        linked so the underlying rows stay one click away instead of shipping unread in every page load.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function GradesClient({
  data,
  anchors,
  reconstruction = null,
  anchorsN,
}: {
  data: GradesPageData;
  /** The per-anchor rows (batch 2c) — the scatter's input. */
  anchors: DcGradesAnchor[];
  reconstruction?: ReconstructionNote | null;
  anchorsN: number;
}) {
  const strict = data.legs?.strict;
  const extended = data.legs?.extended;

  return (
    <>
      <PairedGradingSection data={data} strict={strict} extended={extended} />
      <AnchorScatter anchors={anchors} legs={data.legs} />
      <InversionSection data={data} />
      <ScenarioSection scenarios={data.scenarios} />
      <LeadLagSection leadlag={data.leadlag} />
      <PowerNowcastSection nowcast={data.power_nowcast} />
      <MethodologySection
        data={data}
        strict={strict}
        extended={extended}
        reconstruction={reconstruction}
        anchorsN={anchorsN}
      />
    </>
  );
}
