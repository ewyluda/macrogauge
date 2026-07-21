import type { Metadata } from "next";
import capacityJson from "../../../public/data/capacity.json";
import { KpiCard } from "@/components/KpiCard";
import { CapacityClient } from "@/components/capacity/CapacityClient";
import type { Capacity } from "@/lib/types";

const data = capacityJson as unknown as Capacity;
const all = data.cohorts.all;
const gw = (mw: number) => (mw / 1000).toFixed(1);

export const metadata: Metadata = {
  title: `AI Capacity: ${gw(all.op + all.con + all.plan)} GW tracked across ${all.companies} companies · repriced daily`,
  description:
    "Who has the AI megawatts — neoclouds, ex-BTC-miner landlords, and hyperscalers: operational / construction / planned critical-IT MW, with valuations repriced daily.",
};

export default function Page() {
  const ref = data.reference;
  return (
    <div>
      <h1>
        AI Capacity <span className="subtitle">who has the megawatts?</span>
      </h1>
      <p className="lede">
        Sellable and self-use <b>AI critical-IT megawatts</b> across the
        pure-play GPU clouds, the ex-bitcoin-miners pivoting into AI
        colocation, and the hyperscalers — what each is worth per megawatt,
        who its customers are, and when the capacity arrives. MW numbers are
        hand-curated from filings; valuations reprice every morning. Market
        cap ≠ megawatts — the gap is the whole point.
      </p>
      <div className="kpi-row">
        <KpiCard label="Tracked capacity" value={`${gw(all.op + all.con + all.plan)} GW`}
          context={`${all.companies} companies · op + construction + planned`} accent="sky" />
        <KpiCard label="Operational today" value={`${gw(all.op)} GW`}
          context={`neoclouds ${gw(data.cohorts.neocloud.op)} GW · hyperscalers ${gw(data.cohorts.hyperscaler.op)} GW`} accent="amber" />
        <KpiCard label="Under construction" value={`${gw(all.con)} GW`}
          context="the delivery question — pipeline ≠ revenue until energized" accent="violet" />
        <KpiCard label="NVDA vs the field"
          value={ref.nvda_cap_b != null ? `$${(ref.nvda_cap_b / 1000).toFixed(1)}T` : "—"}
          context={ref.cohort_ev_b != null
            ? `Nvidia market cap vs $${(ref.cohort_ev_b / 1000).toFixed(1)}T combined tracked EV`
            : "Nvidia market cap (cohort EV pending first repricing)"} accent="sky" />
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
        MW data as of <b>{data.as_of_curated}</b>
        {data.priced_date ? <> · priced <b>{data.priced_date}</b></> : <> · awaiting first repricing run</>}
      </p>
      <CapacityClient data={data} />
    </div>
  );
}
