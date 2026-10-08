import Link from "next/link";
import type { Metadata } from "next";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import dcJson from "../../../public/data/datacenter.json";
import longleadJson from "../../../public/data/longlead.json";
import { Section } from "@/components/Section";
import { EscalationSinceClient } from "@/components/EscalationSinceClient";
import { monthlyAverage, type MonthlySeries } from "@/lib/escalationSince";
import { artifact } from "@/lib/artifact";

export const metadata: Metadata = {
  title: "Since-Date Calculator — escalation since your bid or NTP month",
  description:
    "What the DC Build, Ops and Hardware indexes, the long-lead equipment PPIs and CPI have done since your bid or notice-to-proceed month, each rebased to 100 on that month.",
};

// Only these narrow monthly series reach the client — never the artifacts.
const dc = artifact("datacenter", dcJson);
const LONG_LEAD = new Set(artifact("longlead", longleadJson).packages.map((p) => p.code));

const DC_GROUP = "MacroGauge DC indexes";
const SERIES: MonthlySeries[] = [
  ...(["build", "ops", "hardware"] as const).map((k) => ({
    key: `dc_${k}`, label: `DC ${k[0].toUpperCase()}${k.slice(1)} index`, group: DC_GROUP,
    source: `MacroGauge composite, ${dc.rebase}`,
    months: dc.indexes[k].monthly.months, values: dc.indexes[k].monthly.index,
  })),
  ...(dc.clause_series ?? []).map((c) => ({
    key: c.code, label: c.label,
    group: c.basket === "reference" ? "Prices"
      : LONG_LEAD.has(c.code) ? "Long-lead equipment"
      : c.basket === "ops" ? "Operating costs" : "Other build packages",
    source: `${c.source_id}, latest revised values`,
    months: c.months, values: c.latest,
  })),
  {
    key: "gauge", label: "MacroGauge (CPI-comparable)", group: "Prices",
    source: "daily gauge, calendar-month average; the current month to date",
    ...monthlyAverage(gaugeDaily.variants.gauge.dates, gaugeDaily.variants.gauge.index),
  },
].filter((s) => s.months.length > 1);

const build = dc.indexes.build.monthly.months;
const DEFAULT_SINCE = build[Math.max(0, build.length - 25)];
const DEFAULT_PICKS = ["dc_build", "transformers", "switchgear", "cpi_u"];

export default function Calculator() {
  return (
    <div>
      <h1>
        The Since-Date Calculator{" "}
        <span className="subtitle">what your cost indexes have done since the bid</span>
      </h1>
      <p className="lede">
        Pick your bid or notice-to-proceed month and the indexes your contract could ride: the DC cost indexes, the
        long-lead equipment PPIs, CPI. Each is rebased to 100 on that month.
      </p>
      <EscalationSinceClient series={SERIES} defaultSince={DEFAULT_SINCE} defaultPicks={DEFAULT_PICKS} />
      <Section title="Methodology">
        <p className="method">
          The DC Build, Ops and Hardware indexes are MacroGauge composites ({dc.rebase}) and run to the current month;
          the package series are the official BLS PPI and CES series behind them, at their latest revised values, as on
          the <Link href="/escalation/clause">clause kit</Link>. CPI-U is all items, not seasonally adjusted (CPIAUCNS).
          The MacroGauge gauge is the daily CPI-comparable index averaged by calendar month. Change = latest level ÷
          bid-month level − 1; annualized = (latest ÷ bid month)^(12 ÷ months) − 1, shown from twelve months on. See{" "}
          <Link href="/methodology">methodology</Link> for how each index is built.
        </p>
      </Section>
    </div>
  );
}
