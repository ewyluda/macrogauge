import type { Metadata } from "next";
import marketsJson from "../../../public/data/dc_markets.json";
import { KpiCard } from "@/components/KpiCard";
import { MarketsClient } from "@/components/markets/MarketsClient";
import { tightnessScore } from "@/lib/dcMarkets";
import type { DcMarkets } from "@/lib/types";

const data = marketsJson as unknown as DcMarkets;
const nat = data.national;
const live = data.markets.filter((m) => m.available);
// Ranked by the same composite the table's tightness badge uses — wage
// spread alone can crown a different market than the hottest badge.
const hottest = live
  .filter((m) => tightnessScore(m) !== null)
  .sort((a, b) => tightnessScore(b)! - tightnessScore(a)!)[0];

export const metadata: Metadata = {
  title: `DC Market Panel: construction labor across ${live.length} data-center markets`,
  description:
    "Construction wages and headcount where the data centers actually are — county resolution, against the national rate, for 20 real DC markets.",
};

export default function Page() {
  return (
    <div>
      <h1>
        DC Market Panel <span className="subtitle">how tight is the labor where you&apos;re building?</span>
      </h1>
      <p className="lede">
        State resolution averages Loudoun with Bristol. This is{" "}
        <b>construction wages and headcount where the shovels are</b> — tight
        core counties for {data.markets.length} real data-center markets,
        measured against the national rate. Craft labor is the constraint
        nobody prices until it bites: a market adding construction workers
        twice as fast as the country is a market where your subcontractor
        coverage is thinning.
      </p>
      <div className="kpi-row">
        <KpiCard label="National construction wage"
          value={nat.wage != null ? `$${nat.wage.toLocaleString()}/wk` : "—"}
          context={nat.wage_yoy_pct != null
            ? `${nat.wage_yoy_pct > 0 ? "+" : ""}${nat.wage_yoy_pct}% YoY · private NAICS 23`
            : "awaiting first QCEW quarter"} accent="sky" />
        <KpiCard label="National headcount"
          value={nat.emp != null ? `${(nat.emp / 1e6).toFixed(2)}M` : "—"}
          context={nat.emp_yoy_pct != null
            ? `${nat.emp_yoy_pct > 0 ? "+" : ""}${nat.emp_yoy_pct}% YoY`
            : "—"} accent="amber" />
        <KpiCard label="Tightest market"
          value={hottest ? hottest.name : "—"}
          context={hottest && hottest.wage_spread_pp != null
            ? `${hottest.wage_spread_pp > 0 ? "+" : ""}${hottest.wage_spread_pp}pp wage vs national`
            : "—"} accent="violet" />
        <KpiCard label="Markets covered"
          value={`${live.length} / ${data.markets.length}`}
          context="the rest are BLS disclosure-suppressed" accent="sky" />
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
        QCEW quarter <b>{data.as_of ?? "—"}</b> vs <b>{data.base_date ?? "—"}</b>
        {" "}· roster curated <b>{data.as_of_curated}</b>. QCEW publishes ~7 months
        after quarter end — these are the freshest county wages that exist, not
        a current reading.
      </p>
      <MarketsClient data={data} />
      <p className="method">
        <b>Wage is employment-weighted</b> across each market&apos;s counties, and
        year-over-year uses a like-for-like county set: a county
        disclosure-suppressed in either quarter is excluded from both sides, so
        composition change can&apos;t contaminate the rate. Markets are{" "}
        <b>tight core counties</b> — where data centers actually are, not the
        metro area; per-county receipts expand on every row so the aggregation
        is checkable. <b>Wage $/wk, Wage YoY and Headcount YoY stay on that
        like-for-like basis; Constr. workers is the market&apos;s full
        current-quarter headcount</b> (<code>emp_cur_total</code>), independent
        of whether a county cleared last year&apos;s disclosure bar — expand a
        row for the reconciling current-quarter total and any counties the
        like-for-like receipts exclude (marked <b>†</b> when partial). <b>
        Tightness</b> buckets a composite score — the wage spread in
        percentage points plus half the employment spread — at <b>≥10 Hot</b>,{" "}
        <b>≥3 Warm</b>, and <b>above −3 Neutral</b>; <b>−3 or below is Slack</b>.
        {" "}<b>MW under constr.</b> counts only capacity tagged under
        construction at hand-curated sites; operating capacity is shown
        separately, beside the tracked-site count, because an energized
        campus is a completed draw on the labor pool, not a live one.
        {" "}{data.coverage_note}{" "}
        Utility and ISO are hand-curated attributes of the market, not derived.
      </p>
    </div>
  );
}
