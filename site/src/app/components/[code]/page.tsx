import type { Metadata } from "next";
import Link from "next/link";
import replayJson from "../../../../public/data/replay.json";
import gaptable from "../../../../public/data/gaptable.json";
import outlookJson from "../../../../public/data/outlook.json";
import sourcesStatus from "../../../../public/data/sources_status.json";
import seriesJson from "../../../../../config/series.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { ComponentChart } from "@/components/ComponentChart";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { StatusPill } from "@/components/StatusPill";
import { COMPONENTS, COMPONENT_BY_CODE, componentHref, splicePosition } from "@/lib/components";
import { contributionsAt, type ReplayComponent } from "@/lib/contribution";
import { annualizedChange, lastChange, RATE_LOOKBACK_DAYS } from "@/lib/momentum";
import { columnsToRows } from "@/lib/csv";
import { fmtMonth, fmtPp, fmtSigned, yoyColor } from "@/lib/format";

type ReplayFull = {
  published_at: string;
  rebase: string;
  dates: string[];
  components: (ReplayComponent & { index: (number | null)[]; bls_index: (number | null)[]; mode: string; last_obs?: string | null; gate_flags?: string[] })[];
};
const replay = replayJson as unknown as ReplayFull;
const outlook = outlookJson as { origin_month: string; component_paths: Record<string, { month: string; mom_pct: number; index: number }[]> };
const SERIES = Object.fromEntries((seriesJson as { series: { code: string; source: string; name: string; max_staleness_days: number }[] }).series.map((s) => [s.code, s]));
const SOURCES = Object.fromEntries(sourcesStatus.sources.map((s) => [s.name, s]));

export const dynamicParams = false;
export function generateStaticParams() {
  return COMPONENTS.map((c) => ({ code: c.code }));
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const c = COMPONENT_BY_CODE[code];
  const rc = replay.components.find((x) => x.code === code);
  const yoy = rc ? rc.yoy[rc.yoy.length - 1] : null;
  return {
    title: `${c?.label ?? code} — ${fmtSigned(yoy)} YoY, receipts`,
    description: `${c?.label ?? code}: weight, live sources, splice point, gate holds, momentum and contribution — ours vs the BLS series it is graded against.`,
  };
}

const WEEKLY = 7;

export default async function ComponentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = COMPONENT_BY_CODE[code];
  const rc = replay.components.find((x) => x.code === code)!;
  const last = replay.dates.length - 1;
  const own = lastChange(rc.index);
  const splice = rc.mode === "live" ? splicePosition(rc.index, rc.bls_index) : null;
  const spliceDate = splice == null ? null : replay.dates[splice];
  const gateDates = (rc.gate_flags ?? []).map((f) => f.split("@")[1]).filter(Boolean);
  const ours = contributionsAt(replay.components, "ours", last);
  const bls = contributionsAt(replay.components, "bls", last);
  const contrib = ours?.find((x) => x.code === code)?.pp ?? null;
  const blsContrib = bls?.find((x) => x.code === code)?.pp ?? null;
  const ann3 = annualizedChange(rc.index, RATE_LOOKBACK_DAYS.ann3)[own];
  const ann6 = annualizedChange(rc.index, RATE_LOOKBACK_DAYS.ann6)[own];
  const gapRow = gaptable.rows.find((r) => r.component === code);
  const path = outlook.component_paths[code] ?? [];
  const idx = COMPONENTS.findIndex((x) => x.code === code);
  const prev = COMPONENTS[(idx + COMPONENTS.length - 1) % COMPONENTS.length];
  const next = COMPONENTS[(idx + 1) % COMPONENTS.length];
  // weekly sampling for the chart + CSV — the daily grid is forward-filled,
  // so every 7th point loses nothing a reader can see at this scale
  const keep = replay.dates.map((_, i) => i).filter((i) => i % WEEKLY === 0 || i === last || i === splice);
  const wk = <T,>(a: T[]) => keep.map((i) => a[i]);
  const liveSources = Object.entries(c.live_blend ?? {}).map(([sc, w]) => {
    const s = SERIES[sc];
    const st = s ? SOURCES[s.source] : undefined;
    return { code: sc, weight: w, name: s?.name ?? sc, source: s?.source ?? "—", limit: s?.max_staleness_days ?? null,
             ok: st?.ok ?? null, latest_obs: st?.latest_obs ?? null, new_rows: st?.new_rows ?? null, lead_days: c.lead_days?.[sc] ?? null };
  });

  return (
    <div>
      <div className="component-nav" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        <Link href={componentHref(prev.code)}>← {prev.label}</Link>
        <span>component {idx + 1} of {COMPONENTS.length} · <Link href="/gap">all components</Link></span>
        <Link href={componentHref(next.code)}>{next.label} →</Link>
      </div>
      <h1>
        {c.label} <span className="subtitle">{(c.weight * 100).toFixed(1)}% of the basket · {rc.mode === "live" ? "rides live data" : "BLS carry-forward"} · graded vs {c.official_series}</span>
      </h1>
      <p className="lede">
        {rc.mode === "live"
          ? `This component is re-priced from live market data blended and spliced onto the official BLS series at the splice point marked on the chart. Everything below is the receipt: which sources, how fresh, where the splice sits, whether the quality gate ever held a print.`
          : `This component has no live source yet: its index carries the official BLS series forward between prints, so ours and BLS coincide by construction. The receipts below still show its weight, momentum and contribution.`}
      </p>
      <div className="kpi-row">
        <KpiCard label="YoY (ours)" value={fmtSigned(rc.yoy[last])} context={`own last obs ${rc.last_obs ?? replay.dates[own]} · BLS ${fmtSigned(rc.bls_yoy[last])}`} accent="sky" />
        <KpiCard label="Contribution to headline" value={fmtPp(contrib)} context={`weight × own YoY · BLS reconstruction ${fmtPp(blsContrib)}`} accent="violet" />
        <KpiCard label="Gap vs BLS" value={fmtPp(gapRow?.gap_pp ?? null)} context={gapRow ? `contribution to the headline gap ${fmtPp(gapRow.contribution_pp)} · ${gaptable.as_of}` : "no gap row"} accent={(gapRow?.gap_pp ?? 0) > 0 ? "red" : "emerald"} />
        <KpiCard label="Momentum" value={fmtSigned(ann3)} context={`3m annualized · 6m ${fmtSigned(ann6)} · at own last obs ${replay.dates[own]}`} accent={(ann3 ?? 0) > (rc.yoy[last] ?? 0) ? "red" : "emerald"} />
      </div>
      <Citation series={`${c.label} component YoY`} asOf={rc.last_obs ?? replay.dates[last]} rebase={replay.rebase} value={`${fmtSigned(rc.yoy[last])} YoY`} path={componentHref(code)} />

      <Section title="Ours vs BLS — daily since 2018" featured>
        <div className="section-tools">
          <DownloadData filename={`macrogauge-component-${code}`} json="replay.json"
            citation={`MacroGauge ${c.label} component, weekly-sampled daily grid, ${replay.rebase}, as of ${replay.dates[last]}`}
            rows={columnsToRows({ name: "date", values: wk(replay.dates) }, [
              { name: "index", values: wk(rc.index) }, { name: "bls_index", values: wk(rc.bls_index) },
              { name: "yoy_pct", values: wk(rc.yoy) }, { name: "bls_yoy_pct", values: wk(rc.bls_yoy) },
            ])} />
        </div>
        <div className="chart-card">
          <ComponentChart dates={wk(replay.dates)} index={wk(rc.index)} bls={wk(rc.bls_index)} yoy={wk(rc.yoy)} blsYoy={wk(rc.bls_yoy)}
            spliceDate={spliceDate} gateDates={gateDates} label={c.label} />
        </div>
        <p className="method">
          {spliceDate ? `Splice point ${spliceDate}: the first grid day ours departs from the official index — live data grafted onto official history from here. ` : ""}
          {gateDates.length ? `Gate holds: ${gateDates.join(", ")} — a just-arrived print that jumped more than 5% was held one day. ` : "No gate hold on record for this component. "}
          Component YoY is computed at the component&apos;s own observation dates (like-month vs like-month) and carried forward between prints — never a forward-filled value against a different-month base.
        </p>
      </Section>

      <Section title="Sources and freshness">
        {liveSources.length ? (
          <div className="table-card">
            <table className="data-table">
              <thead><tr><th style={{ textAlign: "left" }}>Series</th><th>Blend weight</th><th>Source</th><th>Status</th><th>Latest obs</th><th>New rows today</th><th>Staleness limit</th><th>Lead</th></tr></thead>
              <tbody>
                {liveSources.map((s) => (
                  <tr key={s.code}>
                    <td style={{ textAlign: "left" }}>{s.name} <span style={{ color: "var(--muted)", fontSize: 11 }}>{s.code}</span></td>
                    <td>{(s.weight * 100).toFixed(0)}%</td>
                    <td><span className="badge badge-muted">{s.source}</span></td>
                    <td>{s.ok == null ? "—" : <StatusPill tone={s.ok ? "ok" : "advisory"} label={s.ok ? "ok" : "error"} />}</td>
                    <td style={{ color: "var(--muted)" }}>{s.latest_obs ?? "—"}</td>
                    <td>{s.new_rows ?? "—"}</td>
                    <td style={{ color: "var(--muted)" }}>{s.limit == null ? "—" : `${s.limit}d`}</td>
                    <td style={{ color: "var(--muted)" }}>{s.lead_days == null ? "—" : `+${s.lead_days}d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="method">No live blend configured (config/basket.json). Official series: {c.official_series}. Live variants: none.</p>
        )}
        <p className="method">
          Official series {c.official_series} · live in variants {c.live_variants?.length ? c.live_variants.join(", ") : "none"} · blend weights renormalize as sources phase in.
          Source status is the run-level row from <a href="/status">/status</a>; a blend source past its staleness limit drops out of coverage.
        </p>
      </Section>

      {path.length > 0 && (
        <Section title={`12-month outlook path — from ${outlook.origin_month}`}>
          <div className="table-card">
            <table className="data-table">
              <thead><tr>{path.map((p) => <th key={p.month}>{fmtMonth(`${p.month}-01`)}</th>)}</tr></thead>
              <tbody>
                <tr>{path.map((p) => <td key={p.month} style={{ color: yoyColor(p.mom_pct) }}>{fmtSigned(p.mom_pct)}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="method">Monthly changes the <a href="/outlook">outlook</a> carries for this component; a forward-driver where one applies, else the trailing median of its own real changes. Projection, not a promise.</p>
        </Section>
      )}
    </div>
  );
}
