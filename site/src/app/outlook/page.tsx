import type { Metadata } from "next";
import outlookJson from "../../../public/data/outlook.json";
import quiltJson from "../../../public/data/quilt_months_24.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { OutlookChart } from "@/components/OutlookChart";
import { fmtMonth, yoyColor } from "@/lib/format";
import type { Outlook } from "@/lib/types";

export const metadata: Metadata = {
  title: "Outlook",
  description:
    "12-month inflation outlook with per-component forecast paths and forward-driver readiness.",
};

// Local types for the FULL outlook artifact. lib/types.ts deliberately prunes
// `parameters` to the one knob the chart labels and drops `component_paths`
// (see the comment there) — this page is the one consumer of the full file,
// so the full shape lives here instead of widening the shared type.
type OutlookPathPoint = { month: string; mom_pct: number; index: number };
type OutlookDriver = Outlook["drivers"][number];
type OutlookParameters = {
  baseline_annual_pct: number;
  trailing_median_months?: number;
  wages?: { service_components?: string[] };
  goods_pipeline?: { components?: string[] };
};
type OutlookFull = Omit<Outlook, "parameters"> & {
  parameters: OutlookParameters;
  component_paths: Record<string, OutlookPathPoint[]>;
};

type QuiltComponent = {
  code: string;
  label: string;
  weight: number;
  ours_yoy_pct: (number | null)[];
  official_yoy_pct: (number | null)[];
};

// Cast, don't infer: published artifacts legally degrade (see lib/types.ts).
const outlook = outlookJson as OutlookFull;
const quiltMonths = quiltJson.months as string[];
const quiltComponents = quiltJson.components as QuiltComponent[];

// Same strip the homepage does: component_paths (~11KB) and the full
// parameters block never enter the client chart's RSC payload.
const {
  component_paths: componentPaths,
  parameters,
  ...chartRest
} = outlook;
const outlookForChart: Outlook = {
  ...chartRest,
  parameters: { baseline_annual_pct: parameters.baseline_annual_pct },
};

// "Now" per component = the published quilt grid's macrogauge YoY at the
// outlook's origin month (the latest complete month). Pure lookup, no math.
const originIdx = quiltMonths.indexOf(outlook.origin_month);

// Which driver feeds which component, read off the model's own published
// wiring: direct key match (fuel, food_home, nat_gas, used_vehicles,
// new_vehicles), the wage anchor's service_components list, and the
// goods-pipeline tilt's components list. The shelter driver names both
// shelter components in its effect copy ("drives rent and CPI-comparable
// OER"), so it maps to shelter_rent + shelter_owned.
const driverByKey = new Map(outlook.drivers.map((d) => [d.key, d] as const));
function driversFor(code: string): OutlookDriver[] {
  const matched: OutlookDriver[] = [];
  const direct = driverByKey.get(code);
  if (direct) matched.push(direct);
  if (code === "shelter_rent" || code === "shelter_owned") {
    const shelter = driverByKey.get("shelter");
    if (shelter) matched.push(shelter);
  }
  const wages = driverByKey.get("wages");
  if (wages && parameters.wages?.service_components?.includes(code)) {
    matched.push(wages);
  }
  const pipeline = driverByKey.get("goods_pipeline");
  if (pipeline && parameters.goods_pipeline?.components?.includes(code)) {
    matched.push(pipeline);
  }
  return matched;
}

// Published monthly path steps at +1, +6 and +12 months from the origin.
// The pipeline does not publish per-component YoY paths, so none is derived.
const HORIZONS: Array<{ idx: number; label: string }> = [
  { idx: 0, label: "+1mo" },
  { idx: 5, label: "+6mo" },
  { idx: 11, label: "+12mo" },
];
const anyPath = Object.values(componentPaths)[0] ?? [];

// display-only sign formatting at the 2dp the paths are published at
const fmtMom = (v: number | undefined) =>
  v === undefined
    ? "—"
    : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;

const rows = [...quiltComponents].sort((a, b) => b.weight - a.weight);
const terminal = outlook.forecast[outlook.forecast.length - 1];

export default function OutlookPage() {
  return (
    <div>
      <h1>
        Outlook{" "}
        <span className="subtitle">the next 12 months, component by component</span>
      </h1>
      <p className="lede">
        The headline projection from the homepage, plus the drill-down it strips
        out: each of the 14 components&rsquo; published forecast path, and the
        forward market driver (or own-trend fallback) behind it.
      </p>

      <div className="kpi-row">
        <KpiCard
          label="Now · index-level YoY"
          value={`${outlook.latest_complete_month_yoy_pct.toFixed(2)}%`}
          context={`gauge index ratio, ${fmtMonth(`${outlook.origin_month}-01`)} · differs from the homepage's own-obs headline`}
          accent="sky"
        />
        <KpiCard
          label={`+${outlook.horizon_months}mo central`}
          value={`${terminal.central_yoy_pct.toFixed(2)}%`}
          context={`${fmtMonth(`${terminal.month}-01`)} · band ${terminal.low_yoy_pct.toFixed(2)}–${terminal.high_yoy_pct.toFixed(2)}%`}
          accent="emerald"
        />
        <KpiCard
          label="Driver coverage"
          value={`${outlook.driver_coverage_pct.toFixed(0)}%`}
          context={`live = 1, partial = ½ across ${outlook.drivers.length} forward drivers`}
          accent="violet"
        />
      </div>

      <Section title="Headline path — next 12 months" featured>
        <OutlookChart outlook={outlookForChart} />
      </Section>

      <Section title="Component paths">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Weight</th>
                <th>Now YoY{originIdx >= 0 ? ` · ${fmtMonth(`${outlook.origin_month}-01`)}` : ""}</th>
                {HORIZONS.map((h) => (
                  <th key={h.label}>
                    {h.label} MoM
                    {anyPath[h.idx] ? ` · ${fmtMonth(`${anyPath[h.idx].month}-01`)}` : ""}
                  </th>
                ))}
                <th style={{ textAlign: "left" }}>Driver</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const path = componentPaths[c.code];
                const nowYoy =
                  originIdx >= 0 ? (c.ours_yoy_pct[originIdx] ?? null) : null;
                const matched = driversFor(c.code);
                return (
                  <tr key={c.code}>
                    <td>{c.label}</td>
                    <td>{(c.weight * 100).toFixed(1)}%</td>
                    <td style={{ color: yoyColor(nowYoy) }}>
                      {nowYoy === null ? "—" : `${nowYoy.toFixed(2)}%`}
                    </td>
                    {HORIZONS.map((h) => {
                      const mom = path?.[h.idx]?.mom_pct;
                      return (
                        <td key={h.label} style={{ color: yoyColor(mom ?? null) }}>
                          {fmtMom(mom)}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "left" }}>
                      {matched.length ? (
                        matched.map((d) => (
                          <span
                            key={d.key}
                            className={d.status === "live" ? "badge" : "badge badge-muted"}
                            title={`${d.name} · ${d.status}`}
                            style={{ marginRight: 4, whiteSpace: "nowrap" }}
                          >
                            {d.key.replaceAll("_", " ")}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 11 }}>
                          own {parameters.trailing_median_months ?? 12}-mo median
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Drivers">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Reading</th>
                <th>Status</th>
                <th style={{ textAlign: "left" }}>Effect</th>
                <th style={{ textAlign: "left" }}>Sources</th>
                <th>As of</th>
              </tr>
            </thead>
            <tbody>
              {outlook.drivers.map((d) => (
                <tr key={d.key}>
                  <td>{d.name}</td>
                  <td>{d.reading}</td>
                  <td>
                    <span className={d.status === "live" ? "badge" : "badge badge-muted"}>
                      {d.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "left" }}>{d.effect}</td>
                  <td style={{ textAlign: "left", color: "var(--muted)", fontSize: 11 }}>
                    {d.sources.length ? d.sources.join(" + ") : "—"}
                  </td>
                  <td>{d.as_of ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="method">
        {outlook.method} &ldquo;Now YoY&rdquo; is each component&rsquo;s
        macrogauge YoY at {fmtMonth(`${outlook.origin_month}-01`)}, read from the
        published quilt grid. Path columns are the model&rsquo;s published
        month-over-month steps at horizons +1, +6 and +12 — the pipeline does
        not publish per-component YoY paths, so none is derived here. Driver
        badges follow the model&rsquo;s own configuration: direct key matches,
        the wage anchor&rsquo;s service components, the goods-pipeline tilt
        list, and the shelter driver feeding both rent and owned shelter.
        Components with no forward driver ride the trailing median of their own
        complete-month changes.
      </p>
      <p className="method" style={{ color: "var(--accent-amber)" }}>
        {outlook.disclaimer}
      </p>
    </div>
  );
}
