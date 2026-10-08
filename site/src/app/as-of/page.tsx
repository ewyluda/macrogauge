import Link from "next/link";
import type { Metadata } from "next";
import ledgerJson from "../../../public/data/ledger.json";
import compare from "../../../public/data/compare.json";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import dc from "../../../public/data/datacenter.json";
import { AsOfClient } from "@/components/AsOfClient";
import { DownloadData } from "@/components/DownloadData";
import { artifact } from "@/lib/artifact";
import { buildCommit, REPO } from "@/lib/buildInfo";
import { LEDGER_SERIES, todayAtPublishes, type LedgerKey } from "@/lib/ledgerSeries";
import type { Ledger } from "@/lib/types";

const ledger = artifact<"ledger", Ledger>("ledger", ledgerJson);
const sha = buildCommit();

export const metadata: Metadata = {
  title: "Index Ledger — every published DC Build, Hardware, Ops and CPI reading, never restated",
  description: "An append-only ledger of every daily publish's headline readings — the DC cost indexes and the CPI gauge. Pick a date and read the numbers exactly as published, with the repository commit that recorded them.",
};

// today's history for each charted series, by the series' own reference dates
const HISTORY: Record<LedgerKey, { dates: string[]; yoy: (number | null)[] }> = {
  dc_build: { dates: dc.indexes.build.dates, yoy: dc.indexes.build.yoy_pct },
  dc_hardware: { dates: dc.indexes.hardware.dates, yoy: dc.indexes.hardware.yoy_pct },
  dc_ops: { dates: dc.indexes.ops.dates, yoy: dc.indexes.ops.yoy_pct },
  gauge: { dates: gaugeDaily.variants.gauge.dates, yoy: gaugeDaily.variants.gauge.yoy_pct },
};

export default function AsOfPage() {
  const rows = ledger.rows;
  const today = Object.fromEntries(LEDGER_SERIES.map((s) =>
    [s.key, todayAtPublishes(rows, s.asOf, HISTORY[s.key].dates, HISTORY[s.key].yoy)])) as Record<LedgerKey, (number | null)[]>;
  return (
    <div>
      <div className="research-eyebrow">AI infrastructure · Index ledger</div>
      <h1>
        Index Ledger <span className="subtitle">every published reading, never restated</span>
      </h1>
      <p className="lede">
        The vintage store proves what inputs we had on a day. This ledger proves what we <em>published</em>. Every
        daily run appends its headline readings — DC Build, Hardware and Ops, and the CPI gauge — to an append-only
        file in the repository; nothing is ever edited. In a claim or a change order the counterparty cannot argue the
        history was revised: the row is right here with its publish timestamp, and the{" "}
        <a href={`https://github.com/${REPO}/commits/main/store/ledger/pulse.jsonl`}>repository commit that appended it</a>{" "}
        is public.
      </p>
      <div className="section-tools">
        <DownloadData filename="macrogauge-publish-ledger" json="ledger.json" rows={rows}
          citation={`MacroGauge publish ledger, ${rows.length} publishes since ${ledger.first_publish?.slice(0, 10) ?? "—"}`} />
      </div>
      {rows.length ? (
        <AsOfClient rows={rows} today={today} repo={REPO} />
      ) : (
        <p className="method">The ledger has no rows yet — it fills with the next daily publish.</p>
      )}
      <p className="method">
        {rows.length} publishes on record since {ledger.first_publish ? ledger.first_publish.slice(0, 10) : "—"}. Rows before
        2026-09-03 were backfilled from the git history of pulse.json (scripts/backfill_ledger.py) using the same row
        builder the live run uses; fields absent on early rows (DC index, Cost of Living) read as — because those
        artifacts did not exist yet. A row is written before the commit that records it, so it cannot carry its own
        hash: each row links to the ledger file&apos;s history for its publish day, where that commit and its SHA are listed.
        Comparison months come from <Link href="/vs-bls">compare.json</Link>; source: {compare.published_at.slice(0, 10)} publish.
        {sha && <> This page was built from commit{" "}
          <a href={`https://github.com/${REPO}/commit/${sha}`} data-testid="build-sha"><code>{sha.slice(0, 7)}</code></a>.</>}
      </p>
    </div>
  );
}
