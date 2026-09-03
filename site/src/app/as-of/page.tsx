import type { Metadata } from "next";
import ledgerJson from "../../../public/data/ledger.json";
import compare from "../../../public/data/compare.json";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import { AsOfClient } from "@/components/AsOfClient";
import { DownloadData } from "@/components/DownloadData";
import type { Ledger } from "@/lib/types";

const ledger = ledgerJson as Ledger;

export const metadata: Metadata = {
  title: "Point in Time — what the site said on any publish, never restated",
  description: "An append-only ledger of every daily publish's headline readings. Pick a date and read the numbers as they stood that morning.",
};

export default function AsOfPage() {
  const rows = ledger.rows;
  // today's gauge history sampled at the ledger's publish dates
  const g = gaugeDaily.variants.gauge;
  const idx = new Map(g.dates.map((d, i) => [d, i]));
  const todayDates = rows.map((r) => r.date);
  const todayGauge = rows.map((r) => {
    const i = idx.get(r.gauge_as_of ?? r.date);
    return i == null ? null : g.yoy_pct[i];
  });
  return (
    <div>
      <h1>
        Point in Time <span className="subtitle">what the site said on any publish, never restated</span>
      </h1>
      <p className="lede">
        The vintage store proves what inputs we had on a day. This ledger proves what we <em>published</em>. Every
        daily run appends its headline readings to an append-only file in the repository; nothing is ever edited. In a
        claim or a change order the counterparty cannot argue the history was revised — the row is right here, with the
        publish timestamp, and the git commit behind it.
      </p>
      <div className="section-tools">
        <DownloadData filename="macrogauge-publish-ledger" json="ledger.json" rows={rows}
          citation={`MacroGauge publish ledger, ${rows.length} publishes since ${ledger.first_publish?.slice(0, 10) ?? "—"}`} />
      </div>
      {rows.length ? (
        <AsOfClient rows={rows} todayDates={todayDates} todayGauge={todayGauge} />
      ) : (
        <p className="method">The ledger has no rows yet — it fills with the next daily publish.</p>
      )}
      <p className="method">
        {rows.length} publishes on record since {ledger.first_publish ? ledger.first_publish.slice(0, 10) : "—"}. Rows before
        2026-09-03 were backfilled from the git history of pulse.json (scripts/backfill_ledger.py) using the same row
        builder the live run uses; fields absent on early rows (DC index, Cost of Living) read as — because those
        artifacts did not exist yet. Comparison months come from <a href="/vs-bls">compare.json</a>; source: {compare.published_at.slice(0, 10)} publish.
      </p>
    </div>
  );
}
