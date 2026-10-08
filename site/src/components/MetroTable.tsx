import Link from "next/link";
import metrosJson from "../../public/data/metros.json";
import { DownloadData } from "./DownloadData";
import { TailSpark } from "./TailSpark";
import { flattenRow } from "@/lib/csv";
import { fmtMoney, fmtMonth, fmtSigned, yoyColor } from "@/lib/format";
import { metroSlug } from "@/lib/longtail";
import { accelerationStroke } from "@/lib/metroTrail";
import type { Metro, Metros } from "@/lib/types";

const data = metrosJson as Metros;
const dollars = (v: number | null) => (v == null ? "—" : fmtMoney(v, "$"));

/** The 50 largest metros' Zillow rent and home value, ranked by rent YoY,
 *  collapsed behind a summary (was /metros, folded into /housing 2026-10-08;
 *  each metro's own page stays at /metros/[metro]). */
export function MetroTable() {
  const rows: Metro[] = [...data.metros].sort((a, b) => {
    // both-null must return 0, not -Infinity - -Infinity = NaN
    const av = a.zori.yoy_pct ?? -Infinity;
    const bv = b.zori.yoy_pct ?? -Infinity;
    return av === bv ? 0 : bv - av;
  });
  const asOf = data.national.zori.as_of;
  const top = rows[0];
  return (
    <>
      <div className="section-tools">
        <DownloadData filename="macrogauge-metros" json="metros.json"
          citation={`MacroGauge metro rents (Zillow ZORI/ZHVI), as of ${asOf}`}
          rows={rows.map((m) => flattenRow(m))} />
      </div>
      <details className="inv-details" data-testid="metro-table">
        <summary>
          {rows.length} metros, ranked by rent YoY{top?.zori.yoy_pct != null ? ` — ${top.name} leads at ${fmtSigned(top.zori.yoy_pct)}` : ""}
          {asOf ? ` (${fmtMonth(asOf)})` : ""}
        </summary>
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr><th>Metro</th><th>Rent /mo</th><th>Rent YoY</th><th>24-mo rent YoY</th><th>Home value</th><th>Home YoY</th><th>As of</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.region_id}>
                  <td><Link href={`/metros/${metroSlug(m.name)}`}>{m.name}</Link></td>
                  <td>{dollars(m.zori.value)}</td>
                  <td style={{ color: yoyColor(m.zori.yoy_pct) }}>{fmtSigned(m.zori.yoy_pct)}</td>
                  <td><TailSpark tail={m.zori.yoy_tail.yoy_pct} stroke={accelerationStroke(m.zori.yoy_tail.yoy_pct)} label={`${m.name} rent YoY`} /></td>
                  <td>{dollars(m.zhvi.value)}</td>
                  <td style={{ color: yoyColor(m.zhvi.yoy_pct) }}>{fmtSigned(m.zhvi.yoy_pct)}</td>
                  <td>{m.zori.as_of ? fmtMonth(m.zori.as_of) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="method">
        Zillow observed rent (ZORI) and home value (ZHVI) for the 50 largest metros, smoothed and seasonally adjusted,
        verbatim (no live blend). Year-over-year is each metro&apos;s own latest month against the same month a year
        earlier. The trail is the last 24 months of rent YoY: red when rent growth sped up over that span, green when it
        cooled, grey when it barely moved.
      </p>
    </>
  );
}
