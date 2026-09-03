import type { Metadata } from "next";
import housingJson from "../../../public/data/housing.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { LinesChart } from "@/components/LinesChart";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { C } from "@/lib/chartTheme";
import { columnsToRows } from "@/lib/csv";
import { fmtMonth, fmtSigned, yoyColor } from "@/lib/format";
import type { Housing, HousingMeasure } from "@/lib/types";

const data = housingJson as Housing;
const a = data.affordability;
const money = (v: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);

export const metadata: Metadata = {
  title: `Housing — payment takes ${pct(a.share_pct)} of an average paycheck`,
  description:
    "Home prices, rents, sales and a payment-to-income affordability line built from the same marginal-buyer construction the Cost of Living gauge uses.",
};

function MeasureRow({ m }: { m: HousingMeasure }) {
  const v = m.value == null ? "—" : m.unit === "$" || m.unit === "$/mo" ? money(m.value) : m.unit === "units" ? `${(m.value / 1e6).toFixed(2)}M` : m.value.toFixed(1);
  return (
    <tr>
      <td style={{ textAlign: "left" }}>{m.label} <span style={{ color: "var(--muted)", fontSize: 11 }}>{m.code}</span></td>
      <td>{v}{m.unit === "$/mo" ? "/mo" : ""}</td>
      <td style={{ color: yoyColor(m.yoy_pct) }}>{fmtSigned(m.yoy_pct)}</td>
      <td style={{ color: "var(--muted)" }}>{m.as_of ? fmtMonth(m.as_of) : "—"}</td>
    </tr>
  );
}

export default function HousingPage() {
  const h = a.history;
  const rows = [data.prices.zhvi, data.prices.case_shiller, data.prices.fhfa, data.rents.zori, data.rents.aptlist, data.sales];
  return (
    <div>
      <h1>
        Housing <span className="subtitle">prices, rents, sales — and what the payment takes out of a paycheck</span>
      </h1>
      <p className="lede">
        Three price indexes, two rent indexes, existing-home sales and the mortgage rate were all in the store and
        never on a page. The affordability line reuses the Cost of Living gauge&apos;s marginal-buyer construction —
        {` ${Math.round(data.parameters.ltv * 100)}%`} of the Zillow home value financed over {data.parameters.term_months / 12} years at
        the Freddie Mac rate — and divides the monthly payment by one average private earner&apos;s monthly pay.
      </p>
      <div className="kpi-row">
        <KpiCard label="Payment ÷ paycheck" value={pct(a.share_pct)}
          context={`${money(a.payment)}/mo on ${money(a.income)}/mo · ${a.as_of ? fmtMonth(a.as_of) : "—"} · was ${pct(a.share_2018_01_pct)} in Jan 2018`}
          accent={(a.share_pct ?? 0) > (a.share_2018_01_pct ?? 0) ? "red" : "emerald"} />
        <KpiCard label="Home value (ZHVI)" value={money(data.prices.zhvi.value)} context={`${fmtSigned(data.prices.zhvi.yoy_pct)} YoY · ${data.prices.zhvi.as_of ? fmtMonth(data.prices.zhvi.as_of) : "—"}`} accent="sky" />
        <KpiCard label="Rent (ZORI)" value={money(data.rents.zori.value)} context={`${fmtSigned(data.rents.zori.yoy_pct)} YoY · Apartment List ${fmtSigned(data.rents.aptlist.yoy_pct)}`} accent="violet" />
        <KpiCard label="30y mortgage" value={pct(data.mortgage.pmms_30yr.value, 2)} context={`Freddie Mac · MND daily ${pct(data.mortgage.mnd_30yr_daily.value, 2)}`} accent="amber" />
      </div>
      <Citation series="Housing payment-to-income" asOf={a.as_of ?? data.published_at.slice(0, 10)} value={`${pct(a.share_pct)} of an average private paycheck`} path="/housing" />

      <Section title="Affordability — monthly payment as a share of monthly pay, since 2018" featured>
        <div className="section-tools">
          <DownloadData filename="macrogauge-housing-affordability" json="housing.json"
            citation={`MacroGauge affordability (payment ÷ average private earner pay), monthly, through ${a.as_of ?? "—"}`}
            rows={columnsToRows({ name: "month", values: h.months }, [
              { name: "price_financed", values: h.price }, { name: "rate_pct", values: h.rate_pct },
              { name: "payment", values: h.payment }, { name: "income", values: h.income }, { name: "share_pct", values: h.share_pct },
            ])} />
        </div>
        <div className="chart-card">
          <LinesChart height={300} refLine={a.share_2018_01_pct ?? undefined} refLabel="Jan 2018"
            series={[
              { name: "Payment ÷ paycheck (%)", x: h.months, y: h.share_pct, color: C.red },
              { name: "30y rate (%)", x: h.months, y: h.rate_pct, color: C.amber, dashed: true },
            ]} />
        </div>
        <div className="chart-card" style={{ marginTop: 10 }}>
          <LinesChart height={260} yUnit="" yPrefix="$"
            series={[
              { name: "Monthly payment ($)", x: h.months, y: h.payment, color: C.sky },
              { name: "Monthly pay ($)", x: h.months, y: h.income, color: C.emerald, dashed: true },
            ]} />
        </div>
        <p className="method">
          Income proxy: {data.parameters.income_proxy}. Rate: {data.parameters.rate}. This is a single-earner
          affordability read, deliberately harsher than household-income measures; the shape over time is the
          point, and the 2018 level is the reference line.
        </p>
      </Section>

      <Section title="Prices, rents, sales">
        <div className="table-card">
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Measure</th><th>Latest</th><th>YoY</th><th>As of</th></tr></thead>
            <tbody>{rows.map((m) => <MeasureRow key={m.code} m={m} />)}</tbody>
          </table>
        </div>
        <p className="method">
          Case-Shiller and FHFA are indexes (level shown, YoY is the comparable number); Zillow values and rents are
          dollars. Existing-home sales are a seasonally adjusted annual rate. Metro-level rents live on{" "}
          <a href="/metros">/metros</a>; the marginal-buyer shelter variant is on <a href="/cost-of-living">/cost-of-living</a>.
        </p>
      </Section>
    </div>
  );
}
