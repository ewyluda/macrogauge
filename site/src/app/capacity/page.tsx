import type { Metadata } from "next";
import capacityJson from "../../../public/data/capacity.json";
import { KpiCard } from "@/components/KpiCard";
import { CapacityClient } from "@/components/capacity/CapacityClient";
import type { Capacity } from "@/lib/types";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";
import { capacityHeadline } from "@/lib/capacityCohort";
import { fmtDay } from "@/lib/format";
import { Section } from "@/components/Section";
import { KIND_LABEL, STATUS_LABEL, powerDealsTakeaway } from "@/lib/powerDeals";

const data = artifact<"capacity", Capacity>("capacity", capacityJson);
const all = data.cohorts.all;
const gw = (mw: number) => (mw / 1000).toFixed(1);

export const metadata: Metadata = {
  title: `AI Capacity: ${gw(all.op + all.con + all.plan)} GW tracked across ${all.companies} companies · repriced daily`,
  description:
    "Who has the AI megawatts — neoclouds, ex-BTC-miner landlords, and hyperscalers: operational / construction / planned critical-IT MW, with valuations repriced daily.",
};

export default function Page() {
  const ref = data.reference;
  // reference.cohort_ev_b sums EV over exactly these rows (publish/capacity.py):
  // de-duplicated rows that publish an EV/MW — a hyperscaler's conglomerate EV
  // is suppressed on its row, so it is not summed back in here either.
  const evRows = data.companies.filter((c) => c.dupe == null && c.ev_per_mw != null).length;
  const headline = capacityHeadline(data.cohorts, ref, evRows, fmtDay(data.as_of_curated));
  const pd = data.power_deals;
  const pdLead = powerDealsTakeaway(pd);
  return (
    <div>
      <StaleBanner publishedAt={capacityJson.published_at} />
      <h1>
        {headline?.title ?? "AI Capacity"} <span className="subtitle">AI capacity tracker</span>
      </h1>
      {headline && <p className="cap-takeaway" data-testid="cap-takeaway">{headline.detail}</p>}
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
            ? `Nvidia market cap vs $${(ref.cohort_ev_b / 1000).toFixed(2)}T combined EV of the ${evRows} rows with a published EV/MW (hyperscaler and private-builder EVs excluded, as on their rows)`
            : "Nvidia market cap (cohort EV pending first repricing)"} accent="sky" />
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
        MW data as of <b>{data.as_of_curated}</b>
        {data.priced_date ? <> · priced <b>{data.priced_date}</b></> : <> · awaiting first repricing run</>}
        .{" "}Hyperscaler net debt is funded-debt basis (most run net cash; finance leases and
        off-balance-sheet SPV debt excluded — see each row&apos;s note); neocloud net debt
        includes finance leases where disclosed.
      </p>
      <CapacityClient data={data} />

      {pd && pd.deals.length > 0 && (
        <Section id="power-deals" title="The power behind the capacity: who has signed for it">
          {pdLead && <p className="lede" data-testid="power-deals-takeaway">{pdLead}</p>}
          <div className="table-card">
            <table className="data-table power-deals-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Company</th><th style={{ textAlign: "left" }}>Supplier · facility</th>
                  <th style={{ textAlign: "left" }}>Technology</th><th>MW</th><th style={{ textAlign: "left" }}>Deal</th>
                  <th>Announced</th><th style={{ textAlign: "left" }}>Power from</th>
                </tr>
              </thead>
              <tbody>
                {pd.deals.map((d) => (
                  <tr key={`${d.t}-${d.counterparty}-${d.facility}`}>
                    <td style={{ textAlign: "left" }}><strong>{d.name}</strong></td>
                    <td style={{ textAlign: "left" }}>
                      {d.counterparty}
                      <span className="cell-sub">
                        <a href={d.source.url} title={`“${d.quote}” (${d.source.publisher})`}>{d.facility}</a>
                      </span>
                    </td>
                    <td style={{ textAlign: "left" }}>{d.technology}</td>
                    <td>
                      {d.mw_total.toLocaleString("en-US")}
                      <span className="cell-sub">{d.sites > 1 ? `${d.sites} sites × ${d.mw.toLocaleString("en-US")} · ` : ""}{d.mw_basis}</span>
                    </td>
                    <td style={{ textAlign: "left" }} title={d.note ?? d.instrument}>
                      {STATUS_LABEL[d.status]}
                      <span className="cell-sub">{KIND_LABEL[d.kind]}</span>
                    </td>
                    <td style={{ color: "var(--muted)" }}>{d.announced}</td>
                    <td style={{ textAlign: "left", color: "var(--muted)" }}>{d.start ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="method">
            {pd.basis} {pd.mw_note} &ldquo;Deal&rdquo; separates how firm a deal is (signed, pending a regulator&apos;s
            approval, or an MOU, LOI or option) from what it is: a power purchase agreement; utility supply, where the
            utility builds the plants under a service agreement or tariff; or a development or funding deal that
            carries rights to the energy. Each facility links to the release or filing it was read from; hover it for
            the quoted figure. Hand-curated as of {pd.as_of_curated} and refreshed each earnings season.
          </p>
        </Section>
      )}
    </div>
  );
}
