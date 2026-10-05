import type { Metadata } from "next";
import Link from "next/link";
import dcJson from "../../../../public/data/datacenter.json";
import { ClauseKitClient } from "@/components/ClauseKitClient";
import type { ClauseSeries } from "@/lib/clause";

export const metadata: Metadata = {
  title: "Price-adjustment clause kit",
  description: "Settle an index-based price-adjustment clause on the official BLS series behind each data-center cost package — base month, deadband, share, cap/floor and vintage — with copyable clause text.",
};

// clause_series added to datacenter.json 2026-09-29; absent on older artifacts
const series = ((dcJson as unknown as { clause_series?: ClauseSeries[] }).clause_series ?? []).filter((s) => s.months.length > 1);

export default function ClausePage() {
  return (
    <div>
      <h1>Price-adjustment clause kit <span className="subtitle">settle on the agency&apos;s own index</span></h1>
      <p className="lede">
        Escalation clauses reference an official index, not a composite: this settles one on the BLS series behind each
        package of the <Link href="/datacenter">DC Build and Ops indexes</Link>, on a vintage you name. For forward
        carry and contingency, use the <Link href="/escalation">escalation calculator</Link>.
      </p>
      {series.length === 0 ? (
        <p className="method">The official series for the clause kit are missing from this publish.</p>
      ) : (
        <ClauseKitClient series={series} />
      )}
      <p className="method">
        <strong>First print vs latest.</strong> BLS revises PPIs for four months after first publication. Settling on the
        first print makes an adjustment final the day the index is released; settling on the latest value tracks revisions
        (the calculator shows both, and each first print&apos;s release date). Values are the BLS index levels as stored by
        the pipeline&apos;s vintage store; download them from <a href="/data/datacenter.json">datacenter.json</a> (<code>clause_series</code>).
        This is a calculator and a drafting aid, not legal advice — have counsel review any clause.
      </p>
    </div>
  );
}
