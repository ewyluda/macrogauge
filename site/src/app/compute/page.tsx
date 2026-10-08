import Link from "next/link";
import type { Metadata } from "next";
import computeJson from "../../../public/data/compute.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { LinesChart } from "@/components/LinesChart";
import { TailSpark } from "@/components/TailSpark";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { C } from "@/lib/chartTheme";
import { computeIndexRows } from "@/lib/computeCsv";
import { cloudProviders, cloudRows, cloudTakeaway, GPU_LABEL, listOf } from "@/lib/cloudGpu";
import { fmtSigned, yoyColor } from "@/lib/format";
import type { Compute } from "@/lib/types";
import { artifact } from "@/lib/artifact";

const data = artifact<"compute", Compute>("compute", computeJson);
const clouds = cloudProviders(cloudRows(data));
const hasCloud = clouds.length > 0;
const usd = (v: number | null, d = 2) => (v == null ? "—" : `$${v.toFixed(d)}`);
const idx = (v: number | null) => (v == null ? "—" : v.toFixed(1));

export const metadata: Metadata = {
  title: `Compute Prices — token index ${idx(data.token_index.value)}, GPU-hour index ${idx(data.gpu_index.value)}`,
  description: hasCloud
    ? `The cost of a token and of a GPU-hour: current model prices on OpenRouter, GPU list prices at ${listOf(clouds)}, and vast.ai marketplace rentals, collected daily.`
    : "The cost of a token and of a GPU-hour: current model prices on OpenRouter and vast.ai marketplace rentals, collected daily, with two composite indexes.",
};

export default function ComputePage() {
  const ti = data.token_index;
  const gi = data.gpu_index;
  const notInIndex = data.gpus.filter((g) => !g.in_index).map((g) => g.label);
  const days = Math.max(ti.history.dates.length, gi.history.dates.length);
  const cloud = cloudRows(data);
  const cloudLead = cloudTakeaway(cloud);
  const move = (label: string, v: number | null) =>
    v == null ? null : `${label} ${v > 0 ? "up" : v < 0 ? "down" : "flat"}${v === 0 ? "" : ` ${Math.abs(v).toFixed(1)}%`}`;
  const indexTitle = [move("Token prices", ti.chg_30d_pct), move("GPU-hours", gi.chg_30d_pct)].filter(Boolean).join(", ");
  const roster = data.token_roster;
  return (
    <div>
      <h1>
        Compute Prices <span className="subtitle">what a token and a GPU-hour cost, indexed daily</span>
      </h1>
      <p className="lede">
        The DC Hardware index prices the inputs to a data center. This page prices what comes out of one: the
        per-token list prices of the {data.models.length} most-used models on OpenRouter, ranked by what people pay for them;
        {cloud.length > 0 && ` what ${listOf(clouds)} list for a GPU-hour;`}{" "}and what a GPU-hour
        rents for on the vast.ai marketplace. The two composites are chain-linked equal-weight geometric means: each day&apos;s
        move averages the day-over-day price changes of the members priced on both days, so a SKU missing a
        day, joining, or retiring changes who is averaged but never jumps the index — and a deprecated model
        drops out instead of freezing a dead price into it. Collection began {data.history_start ?? "—"}: the history is short
        and says so.
      </p>
      <div className="kpi-row">
        <KpiCard label="Token price index" value={idx(ti.value)}
          context={`${ti.base_date ?? "—"} = 100 · 30d ${fmtSigned(ti.chg_30d_pct)} · as of ${ti.as_of ?? "—"}`}
          accent={(ti.chg_30d_pct ?? 0) > 0 ? "red" : "emerald"} />
        <KpiCard label="GPU-hour index" value={idx(gi.value)}
          context={`${gi.base_date ?? "—"} = 100 · 30d ${fmtSigned(gi.chg_30d_pct)} · as of ${gi.as_of ?? "—"}`}
          accent={(gi.chg_30d_pct ?? 0) > 0 ? "red" : "emerald"} />
        <KpiCard label="History" value={`${days}d`} context={`daily since ${data.history_start ?? "—"} · ${data.models.length} models · ${data.gpus.length} GPU SKUs`} accent="violet" />
      </div>
      <Citation series="Token price index" asOf={ti.as_of ?? data.published_at.slice(0, 10)} rebase={`${ti.base_date ?? "—"}=100`} value={idx(ti.value)} path="/compute" />

      <Section title={indexTitle ? `${indexTitle} in 30 days` : "Composite indexes"} featured>
        <div className="section-tools">
          <DownloadData filename="macrogauge-compute-indexes" json="compute.json"
            citation={`MacroGauge token and GPU-hour price indexes, ${ti.base_date ?? "—"}=100`}
            rows={computeIndexRows(ti.history, gi.history)} />
        </div>
        <div className="chart-card">
          <LinesChart height={300} recessions={false} refLine={100} refLabel="base" yUnit="" fitY
            series={[
              { name: "Token price index", x: ti.history.dates, y: ti.history.index, color: C.sky },
              { name: "GPU-hour index", x: gi.history.dates, y: gi.history.index, color: C.amber },
            ]} />
        </div>
        <p className="method">
          {data.blend.method}. Token prices blend {Math.round(data.blend.in * 100)}% input and {Math.round(data.blend.out * 100)}%
          output per million tokens. A day with fewer than {data.blend.min_members} members publishes null.
          {roster && (
            <> The model roster last changed on {roster.since}. History before it is earlier rosters
              ({roster.retired.join(", ")}), chained in without a rebase: each retired model leaves the index the day
              after its last collected price. The roster is the most-used models by paid spend on OpenRouter,
              reviewed monthly; each model&apos;s tier (frontier, standard, light) follows Ramp&apos;s split of
              enterprise model spend and is a label, never an index weight.</>
          )}
        </p>
      </Section>

      <Section title="Models — list price per million tokens (OpenRouter)">
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Model</th><th>Input</th><th>Output</th><th>Blended</th><th>30d</th><th>As of</th><th>90d</th></tr></thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.key}>
                  <td style={{ textAlign: "left" }}>
                    {m.label}
                    {m.tier && <> <span className="badge badge-muted" data-testid="model-tier">{m.tier}</span></>}
                  </td>
                  <td>{usd(m.in_usd_mtok)}</td>
                  <td>{usd(m.out_usd_mtok)}</td>
                  <td><strong>{usd(m.blended_usd_mtok, 3)}</strong></td>
                  <td style={{ color: yoyColor(m.chg_30d_pct) }}>{fmtSigned(m.chg_30d_pct)}</td>
                  <td style={{ color: "var(--muted)" }}>{m.as_of ?? "not collected"}</td>
                  <td><TailSpark tail={m.tail.values} label={m.label} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {cloud.length > 0 && (
        <Section id="cloud-gpus" title="GPU list prices: what the clouds charge per GPU-hour">
          {cloudLead && <p className="lede" data-testid="cloud-takeaway">{cloudLead}</p>}
          <div className="table-card">
            <table className="data-table cloud-gpu-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>GPU</th>
                  {clouds.map((p) => <th key={p}>{p}</th>)}
                  <th>vast.ai median</th>
                </tr>
              </thead>
              <tbody>
                {cloud.map((r) => (
                  <tr key={r.gpu}>
                    <td style={{ textAlign: "left" }}><strong>{GPU_LABEL[r.gpu] ?? r.gpu}</strong></td>
                    {clouds.map((p) => {
                      const c = r.cells[p];
                      if (!c || c.usd_per_gpu_hr == null) return <td key={p} style={{ color: "var(--muted)" }}>—</td>;
                      const cheapest = !c.stale && c.usd_per_gpu_hr === r.low && r.fresh > 1 && r.low !== r.high;
                      return (
                        <td key={p} className={c.stale ? "cloud-stale" : undefined}
                          title={`${c.instance} · ${c.gpus_per_instance > 1 ? `$${c.usd_per_instance_hr?.toFixed(2)}/hr for ${c.gpus_per_instance} GPUs · ` : ""}${c.region} · as of ${c.as_of}`}>
                          {cheapest ? <strong>{usd(c.usd_per_gpu_hr)}</strong> : usd(c.usd_per_gpu_hr)}
                          <span className="cloud-inst">{c.stale ? `stale · as of ${c.as_of}` : c.instance}</span>
                        </td>
                      );
                    })}
                    <td style={{ color: "var(--muted)" }}>
                      {r.market ? usd(r.market.usd) : "—"}
                      {r.market?.stale && <span className="cloud-inst cloud-market-stale">stale · as of {r.market.as_of}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="method">
            On-demand list prices with no commitment, per GPU-hour: an instance&apos;s hourly price divided by its GPU
            count (8 for HGX-class nodes, 4 for a GB200 node). AWS is US East (N. Virginia) and Azure is East US 2,
            Linux. Oracle publishes per GPU-hour for all regions, and CoreWeave lists one on-demand price per node.
            Nebius publishes per GPU-hour; when it posts a scheduled price change, the new price counts from its
            effective date.
            Every A100 row is the 80GB part; the vast.ai A100 median pools 40GB and 80GB cards. Bold marks the
            lowest current list price for the GPU. A quote older than its staleness limit keeps its cell, marked
            with its date, and drops out of the range, the bold and the summary line. Spot, reserved and
            committed-use prices, which several of these clouds also publish, are left out, as are negotiated
            discounts. List prices change a few times a year, so these rows stay out of the GPU-hour index, which
            tracks the vast.ai marketplace. Google Cloud is not covered: its price catalog needs an API key.
          </p>
        </Section>
      )}

      <Section title="GPU rentals on the vast.ai marketplace: $ per GPU-hour">
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>SKU</th><th>$/GPU-hr</th><th>30d</th><th>As of</th><th>90d</th></tr></thead>
            <tbody>
              {data.gpus.map((g) => (
                <tr key={g.code}>
                  <td style={{ textAlign: "left" }}>{g.label} <span style={{ color: "var(--muted)", fontSize: 11 }}>{g.code}{g.in_index === false ? " · not in index" : ""}</span></td>
                  <td><strong>{usd(g.usd_per_gpu_hr, 3)}</strong></td>
                  <td style={{ color: yoyColor(g.chg_30d_pct) }}>{fmtSigned(g.chg_30d_pct)}</td>
                  <td style={{ color: g.stale && g.as_of ? "var(--accent-amber)" : "var(--muted)" }}>
                    {g.as_of ?? "not collected"}{g.stale && g.as_of ? " · stale" : ""}
                  </td>
                  <td><TailSpark tail={g.tail.values} label={g.label} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="method">
          Rows are the vast.ai marketplace median for the SKU (the sfcompute H100 spot feed retired 2026-09-24;
          its history stays chain-linked in the index). List prices, not
          negotiated rates — the same caveat the DC Hardware index carries for OEM inputs. Series are config
          (config/series.json); a stale series (7-day limit) shows on <Link href="/status">/status</Link> and leaves the mean.
          vast.ai medians cover the whole on-demand market: the API caps a query at 64 offers, so a saturated
          SKU is re-queried in price bands and the bands merged. Rows marked &ldquo;not in index&rdquo;
          {notInIndex.length ? ` (${notInIndex.join(", ")})` : ""} are priced but kept out of the GPU-hour index: admitting a member is a roster
          decision, made once it has enough history.
        </p>
      </Section>
    </div>
  );
}
