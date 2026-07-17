import type { Metadata } from "next";
import metrosJson from "../../../public/data/metros.json";
import { KpiCard } from "@/components/KpiCard";
import { fmtSigned, fmtMonth, yoyColor } from "@/lib/format";
import type { Metros, Metro } from "@/lib/types";

const data = metrosJson as Metros;

export const metadata: Metadata = {
  title: "Metro Rent & Home Values — 50 largest metros, monthly",
  description:
    "Zillow observed rent (ZORI) and home value (ZHVI) for the 50 largest US metros, ranked by rent inflation — the metro rows nowflation keeps national-only.",
};

const dollars = (v: number | null) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`;

/** Static SVG sparkline of a 24-month YoY trail (nulls skipped). Server-safe. */
function TailSpark({ tail }: { tail: (number | null)[] }) {
  const pts = tail
    .map((v, i) => [i, v] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return <span style={{ color: "var(--muted)" }}>—</span>;
  const w = 96;
  const h = 22;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys);
  const span = Math.max(...ys) - min || 1;
  const n = tail.length - 1 || 1;
  const line = pts
    .map(
      ([i, v]) =>
        `${((i / n) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`
    )
    .join(" ");
  const last = ys[ys.length - 1];
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline
        points={line}
        fill="none"
        stroke={yoyColor(last)}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function Yoy({ pct }: { pct: number | null }) {
  return <span style={{ color: yoyColor(pct) }}>{fmtSigned(pct)}</span>;
}

export default function Metros() {
  const rows: Metro[] = [...data.metros].sort((a, b) => {
    // both-null must return 0, not -Infinity - -Infinity = NaN
    const av = a.zori.yoy_pct ?? -Infinity;
    const bv = b.zori.yoy_pct ?? -Infinity;
    return av === bv ? 0 : bv - av;
  });
  const asOf = data.national.zori.as_of;
  return (
    <div>
      <h1>
        Metro Rent &amp; Home Values{" "}
        <span className="subtitle">the 50 largest metros, ranked by rent inflation</span>
      </h1>
      <p className="lede">
        Zillow observed rent (ZORI) and home value (ZHVI) for the 50 largest US
        metros. The connector already downloads every metro row — most trackers,
        including nowflation, keep only the national line. Ranked by year-over-year
        rent, so the metros leading shelter inflation sit on top.
      </p>

      <div className="kpi-row">
        <KpiCard
          label="National rent (ZORI)"
          value={dollars(data.national.zori.value)}
          context={`${fmtSigned(data.national.zori.yoy_pct)} YoY · ${
            asOf ? fmtMonth(asOf) : "—"
          }`}
          accent="sky"
        />
        <KpiCard
          label="National home value (ZHVI)"
          value={dollars(data.national.zhvi.value)}
          context={`${fmtSigned(data.national.zhvi.yoy_pct)} YoY · ${
            data.national.zhvi.as_of ? fmtMonth(data.national.zhvi.as_of) : "—"
          }`}
          accent="violet"
        />
        <KpiCard
          label="Metros tracked"
          value={String(data.metros.length)}
          context="Zillow MSAs by population, from 2018"
          accent="amber"
        />
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Metro</th>
              <th>Rent /mo</th>
              <th>Rent YoY</th>
              <th>24-mo trend</th>
              <th>Home value</th>
              <th>Home YoY</th>
              <th>As of</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.region_id}>
                <td>{m.name}</td>
                <td>{dollars(m.zori.value)}</td>
                <td>
                  <Yoy pct={m.zori.yoy_pct} />
                </td>
                <td>
                  <TailSpark tail={m.zori.yoy_tail.yoy_pct} />
                </td>
                <td>{dollars(m.zhvi.value)}</td>
                <td>
                  <Yoy pct={m.zhvi.yoy_pct} />
                </td>
                <td>{m.zori.as_of ? fmtMonth(m.zori.as_of) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="method">
        Source: Zillow Research (ZORI, ZHVI), smoothed, seasonally adjusted,
        rebased to first-of-month. Year-over-year is each metro&apos;s own latest
        month against the same month a year earlier; the sparkline traces the last
        24 months of that rent-YoY reading. Red = accelerating rent, green =
        cooling. No live blend — these are the published Zillow series verbatim.
      </p>
    </div>
  );
}
