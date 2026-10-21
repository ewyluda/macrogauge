import { C, monthSpan, ogCard } from "@/lib/ogCard";
import { artifact } from "@/lib/artifact";
import { ratesHeadline } from "@/lib/ratesHeadline";
import type { Rates } from "@/lib/types";
import ratesJson from "../../../public/data/rates.json";
import { fmtPp, etDay } from "@/lib/format";

export const dynamic = "force-static";
export const alt = "Macrogauge Cost of Capital — Treasury curve, corporate credit and funding rates";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const data = artifact<"rates", Rates>("rates", ratesJson);
const pct = (v: number | null, d = 2) => (v == null ? "—" : `${v.toFixed(d)}%`);

export default function Image() {
  const ten = data.curve.find((r) => r.code === "DGS10");
  const cr = data.credit;
  const sofr = data.funding?.sofr_30d;
  const headline = ratesHeadline(ten, cr.bbb_yield, cr.bbb_move);
  // the page charts the 10-year from 2019 on
  const h = data.history;
  const from = Math.max(0, h.dates.findIndex((d) => d >= "2019-01-01"));
  const tenYr = h.dgs10.slice(from).filter((v): v is number => v != null);
  // tile colours follow the page's KPI cards: 10y sky, BBB violet, SOFR amber
  return ogCard({
    kicker: "COST OF CAPITAL",
    stamp: `published ${etDay(data.published_at)}`,
    headline: headline ? `${headline.title}.` : "Treasury curve, corporate credit and funding rates, daily.",
    tiles: [
      { label: "10-year Treasury", value: pct(ten?.value ?? null), color: C.sky, ctx: `1y ${fmtPp(ten?.chg_1y_pp ?? null)} · ${ten?.as_of ?? "—"}` },
      ...(cr.bbb_yield?.value != null ? [{ label: "BBB corporate yield", value: pct(cr.bbb_yield.value), color: C.violet, ctx: `1y ${fmtPp(cr.bbb_yield.chg_1y)} · ${cr.bbb_yield.as_of ?? "—"}` }] : []),
      ...(sofr?.value != null ? [{ label: "30-day average SOFR", value: pct(sofr.value), color: C.amber, ctx: `1y ${fmtPp(sofr.chg_1y)} · ${sofr.as_of ?? "—"}` }] : []),
    ],
    spark: tenYr.length > 1 ? { values: tenYr, label: "10-year Treasury · daily", range: monthSpan(h.dates[from], h.dates.at(-1)!) } : null,
  });
}
