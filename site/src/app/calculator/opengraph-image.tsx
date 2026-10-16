import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { rebased, sinceRow, type MonthlySeries } from "@/lib/escalationSince";
import dcJson from "../../../public/data/datacenter.json";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Since-Date Calculator — escalation since your bid or NTP month";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const dc = artifact("datacenter", dcJson);

export default function Image() {
  const m = dc.indexes.build.monthly;
  // the page's default: 24 months back, DC Build beside the two long-lead PPIs
  const since = m.months[Math.max(0, m.months.length - 25)];
  const build: MonthlySeries = { key: "dc_build", label: "DC Build", group: "", source: "", months: m.months, values: m.index };
  const clause = (code: string): MonthlySeries | null => {
    const c = (dc.clause_series ?? []).find((s) => s.code === code);
    return c ? { key: c.code, label: c.label, group: "", source: "", months: c.months, values: c.latest } : null;
  };
  const rows = [
    { s: build, label: "DC Build", color: C.sky },
    { s: clause("transformers"), label: "Transformers", color: C.violet },
    { s: clause("switchgear"), label: "Switchgear", color: C.amber },
  ].map((x) => ({ ...x, r: x.s ? sinceRow(x.s, since, 1_000_000) : null }));
  const line = rebased(build, since);
  return ogCard({
    kicker: "SINCE-DATE CALCULATOR",
    stamp: `since ${since}`,
    headline: "What the DC cost indexes, the long-lead equipment PPIs and CPI have done since your bid or notice-to-proceed month.",
    tiles: rows.map(({ label, color, r }) => ({
      label, value: r ? fmtSigned(r.changePct) : "—", color, ctx: r ? `${since} → ${r.lastMonth}` : `no level in ${since}`,
    })),
    spark: line && { values: line.values, label: `DC Build · ${since} = 100`, range: monthSpan(line.months[0], line.months.at(-1)!) },
  });
}
