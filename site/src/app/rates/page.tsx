import type { Metadata } from "next";
import ratesJson from "../../../public/data/rates.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { CurveChart } from "@/components/CurveChart";
import { LinesChart } from "@/components/LinesChart";
import { TailSpark } from "@/components/TailSpark";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { C } from "@/lib/chartTheme";
import { columnsToRows } from "@/lib/csv";
import { fmtDay, fmtPp } from "@/lib/format";
import type { Rates } from "@/lib/types";

const data = ratesJson as Rates;
const pct = (v: number | null, d = 2) => (v == null ? "—" : `${v.toFixed(d)}%`);
const bn = (v: number | null) => (v == null ? "—" : v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${v.toFixed(0)}B`);
const ten = data.curve.find((r) => r.code === "DGS10");
const two = data.curve.find((r) => r.code === "DGS2");
const s = data.spreads;

export const metadata: Metadata = {
  title: `Rates & Liquidity — 10y ${pct(ten?.value ?? null)}, 2s10s ${fmtPp(s.s2s10s.value)}`,
  description:
    "The Treasury curve, breakevens, real yields, high-yield spread, the dollar, Fed liquidity and the mortgage spread — every series the pipeline already collects daily, in one place.",
};

function Chg({ v, unit = "pp" }: { v: number | null; unit?: "pp" | "%" }) {
  if (v == null) return <span style={{ color: "var(--muted)" }}>—</span>;
  const color = Math.abs(v) < 0.005 ? "var(--muted)" : v > 0 ? "var(--accent-red)" : "var(--accent-emerald)";
  return <span style={{ color }}>{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v).toFixed(2)}{unit}</span>;
}

export default function RatesPage() {
  const h = data.history;
  const from = h.dates.findIndex((d) => d >= "2019-01-01");
  const cut = <T,>(a: T[]) => a.slice(from);
  const liq = data.liquidity;
  const m = data.mortgage;
  return (
    <div>
      <h1>
        Rates &amp; Liquidity <span className="subtitle">the curve, the spreads, and the plumbing behind them</span>
      </h1>
      <p className="lede">
        Eight Treasury tenors, breakevens, the high-yield spread, the dollar, the Fed&apos;s balance sheet and the
        mortgage spread — daily FRED series the pipeline was already collecting and never showed. Every derived
        number here is arithmetic on those levels: 2s10s is DGS10 − DGS2, the real 10-year is DGS10 − T10YIE,
        net liquidity is WALCL − TGA − RRP.
      </p>
      <div className="kpi-row">
        <KpiCard label="10-year Treasury" value={pct(ten?.value ?? null)}
          context={`${ten?.as_of ? fmtDay(ten.as_of) : "—"} · 30d ${fmtPp(ten?.chg_30d_pp ?? null)} · 1y ${fmtPp(ten?.chg_1y_pp ?? null)}`} accent="sky" />
        <KpiCard label="2s10s" value={fmtPp(s.s2s10s.value)}
          context={`${s.s2s10s.value != null && s.s2s10s.value < 0 ? "inverted · " : ""}2y ${pct(two?.value ?? null)} · 30d ${fmtPp(s.s2s10s.chg_30d_pp)}`}
          accent={s.s2s10s.value != null && s.s2s10s.value < 0 ? "red" : "emerald"} />
        <KpiCard label="10y real yield" value={fmtPp(s.real_10y.value)}
          context={`DGS10 − 10y breakeven ${pct(data.breakevens.t10yie.value)}`} accent="violet" />
        <KpiCard label="High-yield OAS" value={fmtPp(data.credit.hy_oas.value)}
          context={`ICE BofA · 30d ${fmtPp(data.credit.hy_oas.chg_30d)} · ${data.credit.hy_oas.as_of ?? "—"}`}
          accent={(data.credit.hy_oas.chg_30d ?? 0) > 0 ? "red" : "emerald"} />
      </div>
      <Citation series="10-year Treasury yield (DGS10)" asOf={ten?.as_of ?? data.published_at.slice(0, 10)} value={pct(ten?.value ?? null)} path="/rates" />

      <Section title="The curve — today vs 30 days and a year ago" featured>
        <div className="section-tools">
          <DownloadData filename="macrogauge-treasury-curve" json="rates.json" rows={data.curve}
            citation={`MacroGauge Treasury curve snapshot, as of ${ten?.as_of ?? "—"}`} />
        </div>
        <div className="chart-card"><CurveChart curve={data.curve} /></div>
        <div className="table-card" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead><tr><th>Tenor</th><th>Yield</th><th>1d</th><th>30d</th><th>1y</th><th>As of</th></tr></thead>
            <tbody>
              {data.curve.map((r) => (
                <tr key={r.code}>
                  <td>{r.label} <span style={{ color: "var(--muted)", fontSize: 11 }}>{r.code}</span></td>
                  <td>{pct(r.value)}</td>
                  <td><Chg v={r.chg_1d_pp} /></td>
                  <td><Chg v={r.chg_30d_pp} /></td>
                  <td><Chg v={r.chg_1y_pp} /></td>
                  <td style={{ color: "var(--muted)" }}>{r.as_of ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Spreads — 2s10s, 3m10y and the real 10-year, since 2019">
        <div className="section-tools">
          <DownloadData filename="macrogauge-rates-history" json="rates.json"
            citation="MacroGauge rates history (daily, DGS10 business-day grid)"
            rows={columnsToRows({ name: "date", values: h.dates }, [
              { name: "dgs3mo", values: h.dgs3mo }, { name: "dgs2", values: h.dgs2 }, { name: "dgs10", values: h.dgs10 },
              { name: "t5yie", values: h.t5yie }, { name: "t10yie", values: h.t10yie }, { name: "hy_oas", values: h.hy_oas },
              { name: "dollar", values: h.dollar }, { name: "spread_2s10s", values: h.spread_2s10s },
              { name: "spread_3m10y", values: h.spread_3m10y }, { name: "real_10y", values: h.real_10y },
            ])} />
        </div>
        <div className="chart-card">
          <LinesChart height={300} refLine={0} refLabel="flat"
            series={[
              { name: "2s10s (pp)", x: cut(h.dates), y: cut(h.spread_2s10s), color: C.sky },
              { name: "3m10y (pp)", x: cut(h.dates), y: cut(h.spread_3m10y), color: C.amber, dashed: true },
              { name: "10y real (pp)", x: cut(h.dates), y: cut(h.real_10y), color: C.violet },
            ]} />
        </div>
      </Section>

      <Section title="Inflation compensation, credit and the dollar">
        <div className="quote-board">
          {[
            ["5y breakeven", data.breakevens.t5yie, "pp"],
            ["10y breakeven", data.breakevens.t10yie, "pp"],
            ["HY OAS", data.credit.hy_oas, "pp"],
            ["Broad dollar", data.dollar, "%"],
            ["GDPNow", data.gdpnow, "pp"],
            ["60m auto loan", data.auto_loan_60m, "pp"],
          ].map(([label, lv, unit]) => {
            const L = lv as Rates["dollar"];
            return (
              <div className="quote-tile" key={L.code}>
                <div className="quote-label">{label as string}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {L.value == null ? "—" : unit === "%" ? L.value.toFixed(1) : `${L.value.toFixed(2)}%`}
                </div>
                <div className="quote-meta" style={{ fontSize: 11, color: "var(--muted)" }}>
                  30d <Chg v={L.chg_30d} unit={unit as "pp" | "%"} /> · 1y <Chg v={L.chg_1y} unit={unit as "pp" | "%"} /> · {L.as_of ?? "—"}
                </div>
                <TailSpark tail={L.tail.values} />
              </div>
            );
          })}
        </div>
        <div className="chart-card" style={{ marginTop: 10 }}>
          <LinesChart height={280} refLine={2} refLabel="2%"
            series={[
              { name: "10y breakeven", x: cut(h.dates), y: cut(h.t10yie), color: C.sky },
              { name: "5y breakeven", x: cut(h.dates), y: cut(h.t5yie), color: C.violet, dashed: true },
              { name: "HY OAS", x: cut(h.dates), y: cut(h.hy_oas), color: C.red },
            ]} />
        </div>
      </Section>

      <Section title="Fed liquidity — balance sheet, TGA, reverse repo">
        <div className="kpi-row">
          <KpiCard label="Net liquidity" value={bn(liq.net_bn)} context={`WALCL − TGA − RRP · ${liq.as_of ?? "—"}`} accent="sky" />
          <KpiCard label="Fed balance sheet" value={bn(liq.walcl_bn)} context="WALCL, total assets" accent="violet" />
          <KpiCard label="Treasury General Account" value={bn(liq.tga_bn)} context="WTREGEN, weekly average" accent="amber" />
          <KpiCard label="Overnight reverse repo" value={bn(liq.rrp_bn)} context="RRPONTSYD, latest daily" accent="emerald" />
        </div>
        <div className="section-tools">
          <DownloadData filename="macrogauge-liquidity" json="rates.json" citation={`MacroGauge net liquidity ($bn), weekly, as of ${liq.as_of ?? "—"}`}
            rows={columnsToRows({ name: "date", values: liq.history.dates }, [
              { name: "walcl_bn", values: liq.history.walcl_bn }, { name: "tga_bn", values: liq.history.tga_bn },
              { name: "rrp_bn", values: liq.history.rrp_bn }, { name: "net_bn", values: liq.history.net_bn },
            ])} />
        </div>
        <div className="chart-card">
          <LinesChart height={280} yUnit="bn" yPrefix="$"
            series={[
              { name: "Net liquidity ($bn)", x: liq.history.dates, y: liq.history.net_bn, color: C.sky },
              { name: "Balance sheet ($bn)", x: liq.history.dates, y: liq.history.walcl_bn, color: C.violet, dashed: true },
              { name: "TGA ($bn)", x: liq.history.dates, y: liq.history.tga_bn, color: C.amber, dashed: true },
              { name: "RRP ($bn)", x: liq.history.dates, y: liq.history.rrp_bn, color: C.emerald, dashed: true },
            ]} />
        </div>
      </Section>

      <Section title="Mortgage spread — 30-year fixed over the 10-year">
        <div className="kpi-row">
          <KpiCard label="30y fixed (Freddie Mac)" value={pct(m.pmms_30yr.value)} context={`weekly · ${m.pmms_30yr.as_of ?? "—"}`} accent="amber" />
          <KpiCard label="30y fixed (MND daily)" value={pct(m.mnd_30yr_daily.value)} context={`daily · ${m.mnd_30yr_daily.as_of ?? "—"}`} accent="sky" />
          <KpiCard label="Spread to 10y" value={fmtPp(m.spread_to_10y_pp)} context="PMMS − DGS10 at the PMMS date" accent={(m.spread_to_10y_pp ?? 0) > 2 ? "red" : "emerald"} />
        </div>
        <div className="chart-card">
          <LinesChart height={260}
            series={[
              { name: "Spread to 10y (pp)", x: m.history.dates, y: m.history.spread_to_10y_pp, color: C.red },
              { name: "30y fixed (%)", x: m.history.dates, y: m.history.pmms_30yr, color: C.amber, dashed: true },
            ]} />
        </div>
        <p className="method">
          Weekly Freddie Mac PMMS prints against the 10-year read on or within seven days before each print. Units are
          normalized once, in the writer: WALCL and TGA arrive in millions of dollars, RRP in billions; all three publish
          in billions. Nothing here feeds the gauge — it is the transmission channel, shown beside it.
        </p>
      </Section>
    </div>
  );
}
