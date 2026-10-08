"use client";
import { useMemo, useState } from "react";
import { elecCell, fmtSpread, mwFmt, pipelineCell, sortMarkets, tightness, tightnessScore, type SortKey } from "@/lib/dcMarkets";
import type { DcMarkets, MarketCounty, MarketPipelineSource, MarketRow } from "@/lib/types";
import { ToneBadge, type Tone } from "@/components/ToneBadge";
import { TailSpark } from "@/components/TailSpark";

const qLabel = (ym: string) => `Q${Math.ceil(Number(ym.slice(5, 7)) / 3)} ${ym.slice(0, 4)}`;

// The eight sortable columns (bound to dcMarkets.ts's SortKey union). Tightness
// is rendered as an extra, non-sortable column — tightness() buckets two
// spreads into one call and sortMarkets() has no key for that composite, so
// it isn't offered as a sort.
const SORT_COLS: [SortKey, string][] = [
  ["name", "Market"], ["wage", "Wage $/wk"], ["wageYoy", "Wage YoY"],
  ["emp", "Constr. workers"], ["empYoy", "Headcount YoY"], ["mw", "Tracked AI projects"],
  ["pipeline", "Market pipeline (C&W)"],
  ["elecYoy", "Electrical contractors (nonres., NAICS 238212)"],
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
  mw: "From the AI capacity tracker: the sites it itemizes, tagged to this market. Not the market's whole pipeline (most colocation and hyperscaler campuses are not itemized). Sorts by MW under construction.",
  pipeline: "Cushman & Wakefield's MW under construction for its market: colocation plus hyperscale self-build, excluding captive and ICT; IT vs facility MW not stated. C&W markets are regions, not our counties, so the region is named whenever it is wider. Sorts by MW under construction.",
  elecYoy: "Private NAICS 238212, nonresidential electrical contractors. Wage YoY (and its spread vs the national 238212 rate) on the like-for-like basis; workers is the current-quarter third-month level. † = at least one county is disclosure-suppressed.",
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

// Whole dollars: QCEW weekly wages are averages, and a cents figure on one
// row (Reno's $1,746.21) reads as false precision beside the others.
function money(v: number | null): string {
  return v != null ? `$${Math.round(v).toLocaleString("en-US")}` : "—";
}

const countyName = (m: MarketRow, fips: string) => m.county_names?.[fips] ?? fips;

// Score above which a bar is drawn to the edge with a break marker — one
// outlier (a single campus in a small county) must not flatten the rest.
const SCORE_CAP = 40;

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
  const focusMarket = (k: string) => {
    setOpen(k);
    requestAnimationFrame(() =>
      document.getElementById(`mk-row-${k}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  // Same keyboard affordance the expandable rows below already carry —
  // sortable headers must not be mouse-only, and aria-sort tells AT which
  // column drives the current order.
  const th = (k: SortKey, label: string, title?: string) => (
    <th key={k}
      aria-sort={key === k ? (desc ? "descending" : "ascending") : undefined}>
      <button type="button" onClick={() => click(k)} title={title}
        style={{ background: "none", border: 0, padding: 0, width: "100%",
                 color: "inherit", cursor: "pointer", font: "inherit",
                 textAlign: "inherit" }}>
        {k === "elecYoy"
          ? <>Electrical contractors <small className="mk-th-sub">(nonres., NAICS 238212)</small></>
          : k === "pipeline"
            ? <>Market pipeline <small className="mk-th-sub">(C&amp;W, under construction)</small></>
            : label}{key === k ? (desc ? " ▾" : " ▴") : ""}
      </button>
    </th>
  );

  return (
    <>
    <TightnessChart markets={data.markets} onPick={focusMarket} />
    <h2 className="mk-table-title">Every market, county by county <span className="subtitle">sort any column; open a row for the per-county receipts</span></h2>
    <div className="table-card mk-table">
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
            <Row key={m.key} m={m} src={data.market_pipeline_source}
              open={open === m.key}
              onToggle={() => setOpen(open === m.key ? null : m.key)} />
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

const BUCKET: Record<ReturnType<typeof tightness>, string> = {
  hot: "Hot", warm: "Warm", neutral: "Neutral", slack: "Slack", na: "—",
};

/** Ranked composite tightness: wage spread vs the national rate plus half the
 *  headcount spread — the same score the table badges. Bars run from zero;
 *  anything past SCORE_CAP is drawn to the edge with a break marker and its
 *  real value. Clicking a market opens its row in the table below. */
function TightnessChart({ markets, onPick }: { markets: MarketRow[]; onPick: (k: string) => void }) {
  const ranked = markets
    .map((m) => ({ m, score: tightnessScore(m) }))
    .filter((r): r is { m: MarketRow; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score);
  const unranked = markets.filter((m) => tightnessScore(m) === null);
  if (!ranked.length) return null;
  const lo = Math.min(0, ...ranked.map((r) => r.score));
  const hi = Math.min(SCORE_CAP, Math.max(...ranked.map((r) => r.score)));
  const span = hi - Math.max(lo, -SCORE_CAP) || 1;
  const zero = (-Math.max(lo, -SCORE_CAP) / span) * 100;
  return (
    <section className="mk-chart" aria-labelledby="mk-chart-title">
      <div className="mk-chart-head">
        <h2 id="mk-chart-title">Where construction labor is tightest</h2>
        <p>Each market&apos;s wage growth above the national rate, plus half its headcount growth above the national rate, in percentage points. Ten or more is hot; three or more is warm.</p>
        <ul className="mk-key">
          {(["hot", "warm", "neutral", "slack"] as const).map((b) => (
            <li key={b}><i className={`mk-swatch mk-${b}`} aria-hidden />{BUCKET[b]}</li>
          ))}
        </ul>
      </div>
      <ol className="mk-bars">
        {ranked.map(({ m, score }) => {
          const b = tightness(m);
          const clipped = Math.abs(score) > SCORE_CAP;
          const v = Math.max(-SCORE_CAP, Math.min(SCORE_CAP, score));
          const w = (Math.abs(v) / span) * 100;
          return (
            <li key={m.key}>
              <button type="button" className="mk-bar-row" onClick={() => onPick(m.key)}
                aria-label={`${m.name}: tightness ${score.toFixed(1)}, ${BUCKET[b]}. Open in table`}>
                <span className="mk-bar-name">{m.name}<small>{m.iso ?? m.grid} · {m.emp_cur_total != null ? `${m.emp_cur_total.toLocaleString("en-US")} workers` : ""}</small></span>
                <span className="mk-bar-track">
                  {lo < 0 && <i className="mk-zero" style={{ left: `${zero}%` }} aria-hidden />}
                  <span className={`mk-bar mk-${b}${clipped ? " is-clipped" : ""}`}
                    style={{ width: `${w}%`, [v >= 0 ? "left" : "right"]: v >= 0 ? `${zero}%` : `${100 - zero}%` }} />
                </span>
                <span className="mk-bar-val">
                  <strong>{score > 0 ? "+" : ""}{score.toFixed(1)}</strong>
                  <small>wage {fmtSpread(m.wage_spread_pp)} · jobs {fmtSpread(m.emp_spread_pp)}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {unranked.length > 0 && (
        <p className="mk-unranked">Not ranked: {unranked.map((m) => m.name).join(", ")} — BLS withholds these counties&apos; construction figures, or there is no year-earlier quarter to compare.</p>
      )}
    </section>
  );
}

// The electrical-contractor (NAICS 238212) cell. It has its own disclosure
// state, independent of the construction columns: Hillsboro is NAICS
// 23-suppressed yet publishes 238212, so it renders on the unavailable
// branch too. Never a zero -- pending / suppressed / live (dcMarkets.ts).
function ElecTd({ m }: { m: MarketRow }) {
  const c = elecCell(m);
  if (c.state === "pending") {
    return <td style={{ color: "var(--muted)" }}
      title="NAICS 238212 data is missing from this publish.">—</td>;
  }
  if (c.state === "suppressed") {
    return (
      <td style={{ color: "var(--muted)" }}>
        —
        <div style={{ fontSize: 11 }}>
          BLS-suppressed{c.counties.length ? ` (${c.counties.map((f) => countyName(m, f)).join(", ")})` : ""}
        </div>
      </td>
    );
  }
  return (
    <td>
      {c.yoy}<small className="mk-vs">{c.spread} vs US</small>
      {c.partial && (
        <span title="Partial county coverage for NAICS 238212 — expand for the basis"> †</span>
      )}
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        {c.workers} workers · {c.wage}/wk
      </div>
    </td>
  );
}

// The broker's market-level figure (C&W). Independent of QCEW disclosure, so
// it renders on the unavailable branch too. Never a zero: pending / none /
// live (dcMarkets.ts pipelineCell).
function PipelineTd({ m, src }: { m: MarketRow; src: MarketPipelineSource | null | undefined }) {
  const c = pipelineCell(m, src);
  if (c.state === "pending") {
    return <td style={{ color: "var(--muted)" }}
      title="The market pipeline column is missing from this publish.">—</td>;
  }
  if (c.state === "none") {
    return (
      <td style={{ color: "var(--muted)" }} title={c.note}>
        —
        <div style={{ fontSize: 11 }}>not broken out by C&amp;W</div>
      </td>
    );
  }
  return (
    <td>
      <span style={{ whiteSpace: "nowrap" }}>{c.mw}</span>
      {c.stale && <> <ToneBadge tone="amber">stale</ToneBadge></>}
      {c.region && <div style={{ fontSize: 11 }}><b className="mk-region">{c.region}</b></div>}
    </td>
  );
}

function MarketToggle({ m, open, onToggle }: { m: MarketRow; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{ background: "none", border: 0, padding: 0, color: "inherit", font: "inherit",
               cursor: "pointer", textAlign: "left" }}>
      {open ? "▾ " : "▸ "}{m.name}{m.thin_base ? " ⚠" : ""}
    </button>
  );
}

// 9 columns on screen: Market, Tightness, Wage, Wage YoY, Workers, Headcount
// YoY, Tracked AI projects, Market pipeline, Electrical contractors. The
// unavailable branch's colSpan (6, then the pipeline and electrical cells) and
// the expanded receipts row's colSpan (9) must track that count.
function Row({ m, src, open, onToggle }: {
  m: MarketRow; src: MarketPipelineSource | null | undefined; open: boolean; onToggle: () => void;
}) {
  if (!m.available) {
    return (
      <>
      <tr id={`mk-row-${m.key}`} onClick={onToggle} style={{ cursor: "pointer" }} className={open ? "is-open" : undefined}>
        <td className="mk-market"><MarketToggle m={m} open={open} onToggle={onToggle} /></td>
        <td colSpan={6} style={{ color: "var(--muted)" }}>
          not available — BLS disclosure suppression
          {m.counties_suppressed.length
            ? ` (${m.counties_suppressed.map((f) => countyName(m, f)).join(", ")})` : ""}
          {m.note ? `: ${m.note}` : ""}
        </td>
        <PipelineTd m={m} src={src} />
        <ElecTd m={m} />
      </tr>
      {open && (
        <tr>
          <td colSpan={9}>
            <PipelineReceipts m={m} src={src} />
            <ElecReceipts m={m} />
          </td>
        </tr>
      )}
      </>
    );
  }
  return (
    <>
      {/* The row keeps its native row role (todo #29): the interactive
          control is a real button in the identifying cell, with the
          expanded state on it; the rest of the row still toggles on click
          for mouse readers. */}
      <tr id={`mk-row-${m.key}`} onClick={onToggle} style={{ cursor: "pointer" }} className={open ? "is-open" : undefined}>
        <td className="mk-market">
          <MarketToggle m={m} open={open} onToggle={onToggle} />
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
        <td>{pct(m.wage_yoy_pct)}<small className="mk-vs">{fmtSpread(m.wage_spread_pp)} vs US</small></td>
        <td>
          {m.emp_cur_total != null ? m.emp_cur_total.toLocaleString("en-US") : "—"}
          {/* 8 quarters over one county set (publish/dc_markets._history), so
              the line moves on hiring, not on a county dropping in or out */}
          {m.history && m.history.emp.length > 1 && (() => {
            const h = m.history!;
            const span = `${qLabel(h.quarters[0])}–${qLabel(h.quarters.at(-1)!)}`;
            // a county missing any quarter is left out of the whole line, so
            // the line can cover fewer counties than the headcount above it:
            // say which, and that its last point is not that headcount
            const partial = h.counties < m.counties_total;
            const covers = partial
              ? `${h.counties} of ${m.counties_total} counties: ${h.fips.map((f) => countyName(m, f)).join(", ")}`
              : "";
            return (
              <span className="mk-trend">
                {/* neutral: a headcount LEVEL, not a signed rate, so the
                    red/emerald rate palette (yoyColor) does not apply */}
                <TailSpark tail={h.emp} stroke="var(--accent-sky)"
                  label={`${m.name} construction workers, ${span}${partial ? `, ${covers} only (latest ${h.emp.at(-1)!.toLocaleString("en-US")})` : ""}`} />
                <small>{span}{partial && <> · {covers}</>}</small>
              </span>
            );
          })()}
        </td>
        <td>{pct(m.emp_yoy_pct)}<small className="mk-vs">{fmtSpread(m.emp_spread_pp)} vs US</small></td>
        <td>
          {/* A zero with undisclosed-MW sites is an unknown, not a measured
              absence — Northern Virginia must never read "0 MW under constr."
              because its tracked site doesn't state a figure. The sub-line
              below carries the disclosure receipt. */}
          {m.sites === 0 ||
          (m.mw_construction === 0 && m.sites_mw_undisclosed > 0)
            ? "—"
            : <span style={{ whiteSpace: "nowrap" }}>{m.mw_construction.toLocaleString("en-US")} MW building</span>}
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {m.sites === 0 ? "none itemized in the AI capacity tracker"
              : `${m.sites} tracked site${m.sites === 1 ? "" : "s"}`}
            {m.mw_operating
              ? ` · ${m.mw_operating.toLocaleString("en-US")} MW operating`
              : ""}
            {m.sites_mw_undisclosed
              ? ` · MW not disclosed at ${m.sites_mw_undisclosed} site${
                  m.sites_mw_undisclosed === 1 ? "" : "s"}`
              : ""}
            {/* Planned / secured are stated-status buckets, not in-flight —
                shown muted, never summed into the construction figure. */}
            {m.mw_planned ? ` · ${m.mw_planned.toLocaleString("en-US")} MW planned` : ""}
            {m.mw_secured ? ` · ${m.mw_secured.toLocaleString("en-US")} MW secured` : ""}
          </div>
        </td>
        <PipelineTd m={m} src={src} />
        <ElecTd m={m} />
      </tr>
      {open && (
        <tr>
          <td colSpan={9}>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 4px" }}>
              {m.note}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
              {m.yoy_basis === "like_for_like"
                ? `${m.counties_used} of ${m.counties_total} counties counted in both quarters (like-for-like basis — Wage $/wk, Wage YoY and Headcount YoY above).`
                : `${m.counties_used} of ${m.counties_total} counties counted in the current quarter only — no year-over-year basis available.`}
              {m.counties_suppressed.length
                ? m.yoy_basis === "like_for_like"
                  ? ` ${m.counties_suppressed.length} more excluded from that basis and from the receipts below (${m.counties_suppressed.map((f) => countyName(m, f)).join(", ")}); any current-quarter data they have is folded into the current-quarter total below, not broken out per county.`
                  : ` ${m.counties_suppressed.length} more (${m.counties_suppressed.map((f) => countyName(m, f)).join(", ")}) have no current-quarter data.`
                : ""}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
              Current-quarter total (the basis for Constr. workers above):{" "}
              {money(m.wage_cur)} wage ·{" "}
              {m.emp_cur_total != null ? m.emp_cur_total.toLocaleString("en-US") : "—"}{" "}
              workers, across every county with current-quarter data.
            </p>
            <table className="data-table">
              <thead>
                <tr><th>County</th><th>Wage</th><th>Wage YoY</th>
                  <th>Workers</th><th>Headcount YoY</th></tr>
              </thead>
              <tbody>
                {m.counties.map((c) => <CountyRow key={c.fips} c={c} name={countyName(m, c.fips)} />)}
                {m.counties_suppressed.map((fips) => (
                  <tr key={fips} style={{ color: "var(--muted)" }}>
                    <td>{countyName(m, fips)} <span className="mk-fips">{fips}</span></td>
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
            <PipelineReceipts m={m} src={src} />
            <ElecReceipts m={m} />
          </td>
        </tr>
      )}
    </>
  );
}

// The broker figure's receipt: document, page, the broker's region and the
// verbatim key-indicators quote the MW came from.
function PipelineReceipts({ m, src }: { m: MarketRow; src: MarketPipelineSource | null | undefined }) {
  const p = m.market_pipeline;
  if (!p || !src) return null;
  const doc = <a href={src.url}>{src.publisher}, {src.doc}</a>;
  if (p.mw_uc == null) {
    return (
      <p className="mk-pipe-receipt" data-testid={`mk-pipe-receipt-${m.key}`}>
        <b>Market pipeline:</b> {p.null_note} (checked: {doc}, {src.doc_date}.)
      </p>
    );
  }
  return (
    <p className="mk-pipe-receipt" data-testid={`mk-pipe-receipt-${m.key}`}>
      <b>Market pipeline</b>, {doc} ({src.doc_date}; key indicators for the half ending {src.period}),
      flipbook p. {p.page}. C&amp;W market: <b>{p.region}</b>
      {p.fit === "close" ? " — the same metro as the counties above" : p.fit === "proxy"
        ? " — a wider region in which this market is one of several named places"
        : " — a wider region containing the counties above"}
      {p.map_labels.length ? ` (map: ${p.map_labels.join(", ")})` : ""}.
      {p.region_note ? ` ${p.region_note}` : ""} Same key-indicators box:{" "}
      <b>{mwFmt(p.mw_uc)} under construction</b>
      {p.mw_operating != null ? `, ${mwFmt(p.mw_operating)} in operation` : ""}
      {p.mw_planned != null ? `, ${mwFmt(p.mw_planned)} planned` : ""} — separate stages, never
      summed. Quote: <q>{p.quote}</q>
      {src.stale && <> <ToneBadge tone="amber">stale</ToneBadge> past {src.stale_after_days} days from the report date; a newer edition is due.</>}
    </p>
  );
}

// Per-county receipts for the NAICS 238212 cell, same layout as the
// construction receipts above so the aggregation is checkable.
function ElecReceipts({ m }: { m: MarketRow }) {
  const e = m.elec;
  if (!e) return null;
  return (
    <>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 4px" }}>
        <b>Electrical contractors (nonres., NAICS 238212)</b>
        {e.as_of ? `, quarter ${e.as_of} vs ${e.base_date ?? "—"}` : ""}:{" "}
        {e.yoy_basis === "like_for_like"
          ? `${e.counties_used} of ${e.counties_total} counties counted in both quarters.`
          : e.available
            ? `${e.counties_used} of ${e.counties_total} counties counted in the current quarter only — no year-over-year basis available.`
            : "no county resolves a level this quarter."}
        {e.counties_suppressed.length
          ? ` Suppressed or missing for 238212: ${e.counties_suppressed.map((f) => countyName(m, f)).join(", ")}.`
          : ""}
        {e.available
          ? ` Current-quarter total ${money(e.wage_cur)} wage · ${
              e.emp_cur_total != null ? e.emp_cur_total.toLocaleString("en-US") : "—"} workers.`
          : ""}
      </p>
      {e.counties.length > 0 && (
        <table className="data-table">
          <thead>
            <tr><th>County</th><th>Wage</th><th>Wage YoY</th>
              <th>Workers</th><th>Headcount YoY</th></tr>
          </thead>
          <tbody>
            {e.counties.map((c) => <CountyRow key={c.fips} c={c} name={countyName(m, c.fips)} />)}
          </tbody>
        </table>
      )}
    </>
  );
}

function CountyRow({ c, name }: { c: MarketCounty; name: string }) {
  return (
    <tr>
      <td>{name} <span className="mk-fips">{c.fips}</span></td>
      <td>{money(c.wage)}</td>
      <td>{pct(c.wage_yoy_pct)}</td>
      <td>{c.emp != null ? c.emp.toLocaleString("en-US") : "—"}</td>
      <td>{pct(c.emp_yoy_pct)}</td>
    </tr>
  );
}
