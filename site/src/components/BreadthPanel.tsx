import quiltJson from "../../public/data/quilt_months_all.json";
import compare from "../../public/data/compare.json";
import { KpiCard } from "./KpiCard";
import { LinesChart } from "./LinesChart";
import { DownloadData } from "./DownloadData";
import { C } from "@/lib/chartTheme";
import { breadthRows, latestBreadth, type QuiltComponent } from "@/lib/breadth";
import { fmtMonth, fmtPct } from "@/lib/format";

const months = quiltJson.months as string[];
const comps = quiltJson.components as QuiltComponent[];
export const BREADTH_OURS = breadthRows(months, comps, "ours");
export const BREADTH_OFFICIAL = breadthRows(months, comps, "official");
export const BREADTH_LATEST = latestBreadth(BREADTH_OURS);

const xs = months.map((m) => `${m}-01`);
const from = xs.findIndex((d) => d >= "2019-01-01");
const cut = <T,>(a: T[]) => a.slice(from);

/** Breadth and robust-central diagnostics over the 14 component YoYs,
 *  computed at build time from the full-history quilt. Server component. */
export function BreadthPanel({ compact = false }: { compact?: boolean }) {
  const L = BREADTH_LATEST;
  if (!L) return null;
  const rowsCsv = BREADTH_OURS.map((r, i) => ({
    month: r.month,
    ours_above_2pct_weight_pct: r.aboveWeightPct,
    ours_accelerating_weight_pct: r.acceleratingWeightPct,
    ours_weighted_median: r.weightedMedian,
    ours_trimmed_mean_16: r.trimmedMean,
    official_weighted_median: BREADTH_OFFICIAL[i].weightedMedian,
    official_trimmed_mean_16: BREADTH_OFFICIAL[i].trimmedMean,
  }));
  return (
    <div>
      <div className="kpi-row">
        <KpiCard label="Breadth · above 2%" value={`${L.aboveWeightPct!.toFixed(0)}%`}
          context={`of basket weight · ${L.aboveCountPct!.toFixed(0)}% of components · ${fmtMonth(`${L.month}-01`)}`}
          accent={L.aboveWeightPct! >= 50 ? "red" : "emerald"} />
        <KpiCard label="Accelerating" value={L.acceleratingWeightPct == null ? "—" : `${L.acceleratingWeightPct.toFixed(0)}%`}
          context="of basket weight with YoY higher than 3 months earlier"
          accent={(L.acceleratingWeightPct ?? 0) >= 50 ? "red" : "emerald"} />
        <KpiCard label="Weighted median" value={fmtPct(L.weightedMedian!)}
          context="the component YoY at the middle of basket weight" accent="violet" />
        <KpiCard label="16% trimmed mean" value={fmtPct(L.trimmedMean!)}
          context="Cleveland-style trim over our 14 coarse components" accent="sky" />
      </div>
      {!compact && (
        <>
          <div className="section-tools">
            <DownloadData rows={rowsCsv} filename="macrogauge-breadth" json="quilt_months_all.json"
              citation={`MacroGauge breadth & trimmed measures over 14 components, monthly, through ${L.month}`} />
          </div>
          <div className="chart-card">
            <LinesChart
              height={260}
              series={[
                { name: "Weight above 2% YoY (ours)", x: cut(xs), y: cut(BREADTH_OURS.map((r) => r.aboveWeightPct)), color: C.red },
                { name: "Weight accelerating vs 3m ago (ours)", x: cut(xs), y: cut(BREADTH_OURS.map((r) => r.acceleratingWeightPct)), color: C.amber, dashed: true },
                { name: "Weight above 2% (official)", x: cut(xs), y: cut(BREADTH_OFFICIAL.map((r) => r.aboveWeightPct)), color: C.muted, dashed: true, step: true },
              ]}
              refLine={50}
              refLabel="half the basket"
            />
          </div>
          <div className="chart-card" style={{ marginTop: 10 }}>
            <LinesChart
              height={260}
              series={[
                { name: "Headline gauge YoY", x: cut(xs), y: cut(compare.gauge_yoy_pct), color: C.sky },
                { name: "16% trimmed mean (ours)", x: cut(xs), y: cut(BREADTH_OURS.map((r) => r.trimmedMean)), color: C.violet },
                { name: "Weighted median (ours)", x: cut(xs), y: cut(BREADTH_OURS.map((r) => r.weightedMedian)), color: C.emerald, dashed: true },
                { name: "16% trimmed mean (official)", x: cut(xs), y: cut(BREADTH_OFFICIAL.map((r) => r.trimmedMean)), color: C.muted, dashed: true, step: true },
              ]}
              refLine={2}
              refLabel="2%"
            />
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>
            Fourteen coarse components, not Cleveland&apos;s 45-item trim — read these as breadth diagnostics beside the
            Cleveland/Atlanta measures on <a href="/matrix">the matrix</a>, not as substitutes. Trimmed mean drops 16% of
            basket weight from each tail (splitting the straddling component) and averages the rest; the median is the
            component at the middle of cumulative weight. Cells are the published quilt YoYs; nothing is re-priced.
          </p>
        </>
      )}
    </div>
  );
}
