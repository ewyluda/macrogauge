import Link from "next/link";
import type { Metadata } from "next";
import commoditiesJson from "../../../public/data/commodities.json";
import { KpiCard } from "@/components/KpiCard";
import { DownloadData } from "@/components/DownloadData";
import { TailSpark } from "@/components/TailSpark";
import { fmtDay, fmtSigned, yoyColor } from "@/lib/format";
import type { Commodities, CommodityRow } from "@/lib/types";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";
import { buildInputsHeadline } from "@/lib/buildInputs";

const data = artifact<"commodities", Commodities>("commodities", commoditiesJson);
const buildRows = data.groups[0]?.rows ?? [];
const headline = buildInputsHeadline(buildRows);

const rowByCode = new Map<string, CommodityRow>(
  data.groups.flatMap((g) => g.rows.map((r) => [r.code, r]))
);
const copper = rowByCode.get("fmp_copper");
const ddr5 = rowByCode.get("dramex_ddr5_16g");
const h100 = rowByCode.get("vast_h100_sxm");
const pjm = rowByCode.get("ice_pjm_west");

export const metadata: Metadata = {
  title: `Build Inputs: ${headline ?? "what the AI build-out is bidding for, priced daily"}`,
  description:
    "The inputs the AI data-center build-out is bidding for — copper, aluminum, steel, DRAM and NAND, GPU-hours, wholesale power and PJM capacity — priced daily, beside energy, gold and agriculture futures.",
};

/** YoY, or where none exists yet a dated stand-in that says what it compares. */
function YoyCell({ r }: { r: CommodityRow }) {
  if (r.yoy_pct != null || !r.chg_alt) return <Chg pct={r.yoy_pct} />;
  return (
    <span className="cm-alt">
      <Chg pct={r.chg_alt.pct} />
      <small>{r.chg_alt.label}</small>
    </span>
  );
}

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
      <StaleBanner publishedAt={commoditiesJson.published_at} />
      <div className="research-eyebrow">AI infrastructure · Build inputs</div>
      <h1>{headline ?? "Build Inputs"}</h1>
      <p className="lede">
        The inputs the AI data-center build-out is bidding for, priced daily as one basket:
        copper, aluminum and steel (feeding the <Link href="/datacenter">DC Build index</Link>),
        DRAM and NAND spot, the GPU-hour, wholesale power and PJM&apos;s capacity auction. Futures
        history runs from 2017, so their year-over-year is real; series we began collecting
        more recently show a dated change instead, saying exactly what it compares. Energy,
        gold and agriculture follow below.
      </p>

      <div className="section-tools">
        <DownloadData
          filename="macrogauge-commodities"
          json="commodities.json"
          citation={`MacroGauge commodities grid, published ${data.published_at}`}
          rows={data.groups.flatMap((g) => g.rows.map(({ spark: _s, ...r }) => ({ group: g.group, ...r })))}
        />
      </div>
      <div className="kpi-row">
        <KpiCard
          label="Copper"
          value={copper ? `$${price(copper.value)}/lb` : "—"}
          context={`${fmtSigned(copper?.yoy_pct ?? null)} YoY — every rack is wired with it`}
          accent="amber"
        />
        {/* the unit lives in the context, not the uppercased label:
            "16Gb" would render as "16GB", a gigabyte */}
        <KpiCard
          label="DDR5 spot"
          value={ddr5?.value != null ? `$${price(ddr5.value)}` : "—"}
          context={`per 16-gigabit chip${ddr5?.chg_alt ? ` · ${fmtSigned(ddr5.chg_alt.pct)} ${ddr5.chg_alt.label}` : ""}`}
          accent="violet"
        />
        <KpiCard
          label="H100 GPU-hour"
          value={h100?.value != null ? `$${price(h100.value)}` : "—"}
          context={`vast.ai market median${h100?.chg_alt ? ` · ${fmtSigned(h100.chg_alt.pct)} ${h100.chg_alt.label}` : ""}`}
          accent="sky"
        />
        <KpiCard
          label="PJM power"
          value={pjm?.value != null ? `$${price(pjm.value)}/MWh` : "—"}
          context={`${fmtSigned(pjm?.yoy_pct ?? null)} YoY · Western Hub, the Northern Virginia grid`}
          accent="red"
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
                  <th>Trend</th>
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
                      <YoyCell r={r} />
                    </td>
                    <td>
                      {/* each row states its own span: 60 daily closes are ~3
                          months, 60 monthly PPI prints are 5 years */}
                      <span className="cm-spark">
                        <TailSpark
                          tail={r.spark}
                          stroke={yoyColor(r.chg_30d_pct)}
                          label={r.spark_span ? `${r.label}, ${r.spark_span}` : r.label}
                        />
                        {r.spark_span && <small>{r.spark_span}</small>}
                      </span>
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
        Futures are front-month closes (FMP); steel is the BLS producer price index for steel mill
        products (monthly); DRAM/NAND are DRAMeXchange session averages, published as derived readings
        with attribution; GPU-hours are vast.ai marketplace medians; wholesale power is day-ahead hub
        LMPs (CAISO, MISO, PJM via EIA/ICE); PJM capacity is the Base Residual Auction clearing price
        per delivery year, its change auction to auction, as on <Link href="/power">Power &amp; Tariffs</Link>.
        30-day and YoY compare against the observation nearest that far back (±3 days — markets close on
        weekends). Where no year-ago reading exists, the YoY column shows a dated change instead: against
        the reading nearest a year back (within a month), or since the first reading. Sparklines trace
        the last 60 observations, and each states the period that covers: about three months for a daily
        price, five years for the monthly steel PPI, and the auctions on record for PJM capacity.
        Copper and aluminum also feed the{" "}
        <Link href="/datacenter">Data Center Cost Index</Link> as anchored forward
        tails — this page shows the raw prices.
      </p>
    </div>
  );
}
