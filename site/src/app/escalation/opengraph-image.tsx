import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { ESCALATION_DATA as data } from "@/lib/escalationData";
import { lastCompleteMonth } from "@/lib/dcContingency";
import { escalate } from "@/lib/dcEscalation";
import dc from "../../../public/data/datacenter.json";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge DC Escalation Calculator — escalate a data-center cost basis by the DC Build index";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  // the calculator's own default window: 24 months back from the last month
  // the whole basket reported, measured only (no forward leg)
  const end = lastCompleteMonth(data.months, data.componentLastObs) ?? data.months[data.months.length - 1];
  const endIdx = data.months.indexOf(end);
  const base = data.months[Math.max(0, endIdx - 24)];
  const r = escalate(data.months, data.index, base, 9_000_000, null, end);
  const from = Math.max(0, endIdx - 60);
  return ogCard({
    kicker: "DC ESCALATION",
    stamp: `index as of ${data.asOf}`,
    headline: "Escalate your own data-center cost basis by the DC Build index — and see how often each contingency basis has run short.",
    tiles: [
      { label: "DC Build · YoY", value: fmtSigned(dc.indexes.build.headline_yoy_pct), color: C.sky, ctx: `as of ${dc.indexes.build.as_of}` },
      { label: "Escalation · 24 months", value: r ? fmtSigned(r.pct) : "—", color: C.violet, ctx: `${base} → ${end}, measured` },
      { label: "Annualized", value: r ? `${r.annualizedPct.toFixed(2)}%/yr` : "—", color: C.amber, ctx: "same window" },
    ],
    spark: { values: data.index.slice(from, endIdx + 1), label: "DC Build index · monthly", range: monthSpan(data.months[from], end) },
  });
}
