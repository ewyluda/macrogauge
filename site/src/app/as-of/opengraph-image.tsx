import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import type { Ledger } from "@/lib/types";
import ledgerJson from "../../../public/data/ledger.json";
import { fmtSigned } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Index Ledger — every published reading, never restated";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"ledger", Ledger>("ledger", ledgerJson);

export default function Image() {
  const rows = data.rows;
  const row = rows[rows.length - 1];
  const build = rows.filter((r) => r.dc_build_yoy_pct != null);
  return ogCard({
    kicker: "INDEX LEDGER",
    stamp: `${rows.length} publishes since ${rows[0]?.date ?? "—"}`,
    headline: "Every published DC Build, Hardware, Ops and CPI reading, appended each publish and never restated.",
    tiles: [
      { label: "DC Build · YoY", value: fmtSigned(row?.dc_build_yoy_pct ?? null), color: C.sky, ctx: `as of ${row?.dc_build_as_of ?? "—"}` },
      { label: "DC Hardware · YoY", value: fmtSigned(row?.dc_hardware_yoy_pct ?? null), color: C.amber, ctx: `as of ${row?.dc_hardware_as_of ?? "—"}` },
      { label: "Macrogauge · YoY", value: fmtSigned(row?.gauge_yoy_pct ?? null), color: C.violet, ctx: `as of ${row?.gauge_as_of ?? "—"}` },
    ],
    spark: build.length > 1 ? {
      values: build.map((r) => r.dc_build_yoy_pct!), label: "DC Build YoY · as published",
      range: monthSpan(build[0].date, build.at(-1)!.date),
    } : null,
  });
}
