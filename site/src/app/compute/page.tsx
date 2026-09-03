import type { Metadata } from "next";
import computeJson from "../../../public/data/compute.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { LinesChart } from "@/components/LinesChart";
import { TailSpark } from "@/components/TailSpark";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { C } from "@/lib/chartTheme";
import { columnsToRows } from "@/lib/csv";
import { fmtSigned, yoyColor } from "@/lib/format";
import type { Compute } from "@/lib/types";

const data = computeJson as Compute;
const usd = (v: number | null, d = 2) => (v == null ? "—" : `$${v.toFixed(d)}`);
const idx = (v: number | null) => (v == null ? "—" : v.toFixed(1));

export const metadata: Metadata = {
  title: `Compute Prices — token index ${idx(data.token_index.value)}, GPU-hour index ${idx(data.gpu_index.value)}`,
  description:
    "The cost of a token and of a GPU-hour: OpenRouter model prices and vast.ai / sfcompute GPU rentals, collected daily, with two composite indexes.",
};

export default function ComputePage() {
  const ti = data.token_index;
  const gi = data.gpu_index;
  const days = Math.max(ti.history.dates.length, gi.history.dates.length);
  return (
    <div>
      <h1>
        Compute Prices <span className="subtitle">what a token and a GPU-hour cost, indexed daily</span>
      </h1>
      <p className="lede">
        The DC Hardware index prices the inputs to a data center. This page prices what comes out of one: the
        per-token list prices of six frontier and open models on OpenRouter, and the rental price of a GPU-hour
        on vast.ai and sfcompute. Both composites are equal-weight geometric means of each member relative to
        its own base-date price, renormalized over the members present, so a deprecated model drops out instead
        of freezing a dead price into the index. Collection began {data.history_start ?? "—"}: the history is short
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

      <Section title="Composite indexes" featured>
        <div className="section-tools">
          <DownloadData filename="macrogauge-compute-indexes" json="compute.json"
            citation={`MacroGauge token and GPU-hour price indexes, ${ti.base_date ?? "—"}=100`}
            rows={columnsToRows({ name: "date", values: ti.history.dates.length >= gi.history.dates.length ? ti.history.dates : gi.history.dates }, [
              { name: "token_index", values: ti.history.index }, { name: "token_members", values: ti.history.members },
              { name: "gpu_index", values: gi.history.index }, { name: "gpu_members", values: gi.history.members },
            ])} />
        </div>
        <div className="chart-card">
          <LinesChart height={300} recessions={false} refLine={100} refLabel="base" yUnit=""
            series={[
              { name: "Token price index", x: ti.history.dates, y: ti.history.index, color: C.sky },
              { name: "GPU-hour index", x: gi.history.dates, y: gi.history.index, color: C.amber },
            ]} />
        </div>
        <p className="method">
          {data.blend.method}. Token prices blend {Math.round(data.blend.in * 100)}% input and {Math.round(data.blend.out * 100)}%
          output per million tokens. A day with fewer than {data.blend.min_members} members publishes null.
        </p>
      </Section>

      <Section title="Models — list price per million tokens (OpenRouter)">
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Model</th><th>Input</th><th>Output</th><th>Blended</th><th>30d</th><th>As of</th><th>90d</th></tr></thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.key}>
                  <td style={{ textAlign: "left" }}>{m.label}</td>
                  <td>{usd(m.in_usd_mtok)}</td>
                  <td>{usd(m.out_usd_mtok)}</td>
                  <td><strong>{usd(m.blended_usd_mtok, 3)}</strong></td>
                  <td style={{ color: yoyColor(m.chg_30d_pct) }}>{fmtSigned(m.chg_30d_pct)}</td>
                  <td style={{ color: "var(--muted)" }}>{m.as_of ?? "not collected"}</td>
                  <td><TailSpark tail={m.tail.values} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="GPU rentals — $ per GPU-hour">
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>SKU</th><th>$/GPU-hr</th><th>30d</th><th>As of</th><th>90d</th></tr></thead>
            <tbody>
              {data.gpus.map((g) => (
                <tr key={g.code}>
                  <td style={{ textAlign: "left" }}>{g.label} <span style={{ color: "var(--muted)", fontSize: 11 }}>{g.code}</span></td>
                  <td><strong>{usd(g.usd_per_gpu_hr, 3)}</strong></td>
                  <td style={{ color: yoyColor(g.chg_30d_pct) }}>{fmtSigned(g.chg_30d_pct)}</td>
                  <td style={{ color: "var(--muted)" }}>{g.as_of ?? "not collected"}</td>
                  <td><TailSpark tail={g.tail.values} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="method">
          vast.ai rows are the marketplace median for the SKU; sfcompute is its spot average. List prices, not
          negotiated rates — the same caveat the DC Hardware index carries for OEM inputs. Series are config
          (config/series.json); a stale series (7-day limit) shows on <a href="/status">/status</a> and leaves the mean.
        </p>
      </Section>
    </div>
  );
}
