import type { Metadata } from "next";
import commoditiesJson from "../../../public/data/commodities.json";
import { KpiCard } from "@/components/KpiCard";
import { TailSpark } from "@/components/TailSpark";
import { fmtDay, fmtSigned, yoyColor } from "@/lib/format";
import type { Commodities, CommodityRow } from "@/lib/types";

const data = commoditiesJson as Commodities;

const rowByCode = new Map<string, CommodityRow>(
  data.groups.flatMap((g) => g.rows.map((r) => [r.code, r]))
);
const copper = rowByCode.get("fmp_copper");
const ddr5 = rowByCode.get("dramex_ddr5_16g");
const h100 = rowByCode.get("vast_h100_sxm");
const wti = rowByCode.get("fmp_wti");

export const metadata: Metadata = {
  title: `Commodities — copper ${fmtSigned(copper?.yoy_pct ?? null)} YoY, the AI build-out basket priced daily`,
  description:
    "Every commodity the pipeline collects — the AI build-out inputs (copper, aluminum, DRAM, GPU-hours, wholesale power) beside energy, metals and agriculture futures, with 3-month sparklines.",
};

function price(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return Math.round(v).toLocaleString("en-US");
  if (v >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function Chg({ pct }: { pct: number | null }) {
  return <span style={{ color: yoyColor(pct) }}>{fmtSigned(pct)}</span>;
}

export default function Page() {
  return (
    <div>
      <h1>
        Commodities{" "}
        <span className="subtitle">the AI build-out basket, priced daily</span>
      </h1>
      <p className="lede">
        Every commodity the pipeline already collects, in one grid. The first
        group is the cross-cut nobody else publishes as a basket: the inputs
        the AI datacenter build-out is bidding for — copper and aluminum
        (feeding the <a href="/datacenter">DC Build index</a>), DRAM spot,
        GPU-hours, and wholesale power. Futures history runs from 2017, so
        year-over-year is real, not a since-launch approximation.
      </p>

      <div className="kpi-row">
        <KpiCard
          label="Copper"
          value={copper ? `$${price(copper.value)}/lb` : "—"}
          context={`${fmtSigned(copper?.yoy_pct ?? null)} YoY — every rack is wired with it`}
          accent="amber"
        />
        <KpiCard
          label="DDR5 16Gb spot"
          value={ddr5?.value != null ? `$${price(ddr5.value)}` : "—"}
          context="the memory supercycle, sampled daily"
          accent="violet"
        />
        <KpiCard
          label="H100 GPU-hour"
          value={h100?.value != null ? `$${price(h100.value)}` : "—"}
          context="vast.ai market median"
          accent="sky"
        />
        <KpiCard
          label="WTI crude"
          value={wti ? `$${price(wti.value)}/bbl` : "—"}
          context={`${fmtSigned(wti?.yoy_pct ?? null)} YoY`}
          accent="emerald"
        />
      </div>

      {data.groups.map((g) => (
        <section key={g.group}>
          <h2 style={{ fontSize: 15, letterSpacing: "0.06em", margin: "26px 0 8px" }}>
            {g.group}
          </h2>
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Commodity</th>
                  <th>Price</th>
                  <th>30-day</th>
                  <th>YoY</th>
                  <th>3-mo trend</th>
                  <th>As of</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={`${g.group}-${r.code}`}>
                    <td>{r.label}</td>
                    <td>
                      {price(r.value)}{" "}
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {r.unit}
                      </span>
                    </td>
                    <td>
                      <Chg pct={r.chg_30d_pct} />
                    </td>
                    <td>
                      <Chg pct={r.yoy_pct} />
                    </td>
                    <td>
                      <TailSpark
                        tail={r.spark}
                        stroke={yoyColor(r.chg_30d_pct)}
                      />
                    </td>
                    <td>{r.as_of ? fmtDay(r.as_of) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="method">
        Futures are front-month closes (FMP); DRAM/NAND are DRAMeXchange
        session averages, published as derived readings with attribution;
        GPU-hours are marketplace medians (vast.ai) and spot averages
        (sfcompute); wholesale power is day-ahead hub LMPs (CAISO, MISO, PJM
        via EIA/ICE). 30-day and YoY compare against the observation nearest
        that far back (±3 days — markets close on weekends). Sparklines trace
        the last 60 observations; new sources fill in as history accrues.
        Copper and aluminum also feed the{" "}
        <a href="/datacenter">Data Center Cost Index</a> as anchored forward
        tails — this page shows the raw prices.
      </p>
    </div>
  );
}
