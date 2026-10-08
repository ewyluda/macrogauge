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
import { RATES_CURVE_CSV, RATES_HISTORY_CSV, RATES_LIQUIDITY_CSV } from "@/lib/exportSpecs";
import { fmtDay, fmtPp } from "@/lib/format";
import type { FedPath, Rates } from "@/lib/types";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";
import { ratesHeadline } from "@/lib/ratesHeadline";

const data = artifact<"rates", Rates>("rates", ratesJson);
const pct = (v: number | null, d = 2) => (v == null ? "—" : `${v.toFixed(d)}%`);
const bn = (v: number | null) => (v == null ? "—" : v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${v.toFixed(0)}B`);
const ten = data.curve.find((r) => r.code === "DGS10");
const two = data.curve.find((r) => r.code === "DGS2");
const s = data.spreads;
const cr = data.credit;
const sofr = data.funding?.sofr_30d;
// one claim as the H1; the 10-year and the attribution window read as a takeaway line
const headline = ratesHeadline(ten, cr.bbb_yield, cr.bbb_move);

export const metadata: Metadata = {
  title: `Cost of Capital: ${headline?.title ?? `10y ${pct(ten?.value ?? null)}, 2s10s ${fmtPp(s.s2s10s.value)}`}`,
  description:
    "The cost of capital for building AI infrastructure: the Treasury curve, investment-grade, BBB and high-yield spreads, BBB all-in yield, 30-day SOFR, breakevens, the dollar, Fed liquidity and the market-implied Fed path — daily FRED series.",
};

function Chg({ v, unit = "pp" }: { v: number | null; unit?: "pp" | "%" }) {
  if (v == null) return <span style={{ color: "var(--muted)" }}>—</span>;
  const color = Math.abs(v) < 0.005 ? "var(--muted)" : v > 0 ? "var(--accent-red)" : "var(--accent-emerald)";
  return <span style={{ color }}>{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v).toFixed(2)}{unit}</span>;
}

const prob = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const bp = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}bp`);

/** Kalshi KXFED market-implied path against the official target (backlog #10a).
 *  Renders only when rates.json carries the block. */
function FedPathSection({ fp }: { fp: FedPath }) {
  const t = fp.target_upper;
  const pathX = t.as_of ? [t.as_of, ...fp.meetings.map((m) => m.date)] : fp.meetings.map((m) => m.date);
  const pathY = t.as_of ? [t.value, ...fp.meetings.map((m) => m.expected_upper)] : fp.meetings.map((m) => m.expected_upper);
  const next = fp.meetings[0];
  return (
    <Section title="Market-implied Fed path — Kalshi FOMC ladders vs the target">
      <div className="kpi-row">
        <KpiCard label="Target range, upper" value={pct(t.value)} context={`DFEDTARU · ${t.as_of ?? "—"}`} accent="sky" />
        <KpiCard label="Effective fed funds" value={pct(fp.effective.value)} context={`FEDFUNDS monthly · ${fp.effective.as_of ?? "—"}`} accent="violet" />
        <KpiCard label={next ? `Next meeting ${fmtDay(next.date)}` : "Next meeting"} value={next ? pct(next.expected_upper) : "—"}
          context={next ? `expected upper · ${bp(next.implied_change_bp)} · P(hike) ${prob(next.p_hike)}` : "no liquid ladder today"}
          accent={next && (next.implied_change_bp ?? 0) > 0 ? "red" : "emerald"} />
      </div>
      {fp.meetings.length > 0 && (
        <div className="chart-card">
          <LinesChart height={260} recessions={false}
            series={[
              { name: "Target upper bound (DFEDTARU)", x: fp.history.dates, y: fp.history.target_upper, color: C.sky, step: true },
              { name: "Market-implied upper bound (Kalshi)", x: pathX, y: pathY, color: C.amber, dashed: true },
            ]} />
        </div>
      )}
      <div className="table-card" style={{ marginTop: 10 }}>
        <table className="data-table">
          <caption className="method" style={{ captionSide: "bottom", textAlign: "left" }}>Probabilities are cumulative from today to each meeting, vs the upper bound now in effect.</caption>
          <thead><tr><th style={{ textAlign: "left" }}>Meeting</th><th>Expected upper</th><th>vs today</th><th>P(cut)</th><th>P(hold)</th><th>P(hike)</th></tr></thead>
          <tbody>
            {fp.meetings.length === 0 ? (
              <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No meeting ladder was liquid enough on the latest fetch.</td></tr>
            ) : fp.meetings.map((m) => (
              <tr key={m.date}>
                <td style={{ textAlign: "left" }}>{fmtDay(m.date)}</td>
                <td><strong>{pct(m.expected_upper)}</strong></td>
                <td>{bp(m.implied_change_bp)}</td>
                <td>{prob(m.p_cut)}</td>
                <td>{prob(m.p_hold)}</td>
                <td>{prob(m.p_hike)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="method">
        {fp.method} Reference upper bound {pct(fp.reference_upper)}
        {fp.reference_matches_target === false ? " — differs from DFEDTARU (FRED lags a fresh decision by a day)" : ""}; quotes as of {fp.as_of ?? "—"}.
        Far-dated meetings rarely trade two-sided, so the table is usually the next one or two meetings. A betting-market
        read, not a forecast of ours.
      </p>
    </Section>
  );
}

export default function RatesPage() {
  const h = data.history;
  const from = h.dates.findIndex((d) => d >= "2019-01-01");
  const cut = <T,>(a: T[]) => a.slice(from);
  const liq = data.liquidity;
  const m = data.mortgage;
  return (
    <div>
      <StaleBanner publishedAt={ratesJson.published_at} />
      <div className="research-eyebrow">AI infrastructure · Cost of capital</div>
      <h1>{headline?.title ?? "Rates & Liquidity"}</h1>
      {headline?.detail && <p className="ll-takeaway" data-testid="rates-takeaway">{headline.detail}</p>}
      <p className="lede">
        The market benchmarks that financing a build is priced against: the Treasury curve, the investment-grade
        and BBB corporate bond spreads and the BBB index&apos;s all-in yield, and 30-day average SOFR — plus
        breakevens, the dollar, the Fed&apos;s balance sheet and the market-implied Fed path, all daily FRED series.
        They are reference rates, not a project&apos;s cost of debt: an actual loan adds its own spread and fees on its
        own terms, and 30-day average SOFR is a backward-looking compounded average, not CME&apos;s forward-looking
        Term SOFR. Every derived number is arithmetic on published levels: 2s10s is DGS10 − DGS2, the real 10-year
        is DGS10 − T10YIE, net liquidity is WALCL − TGA − RRP.
      </p>
      <div className="kpi-row">
        <KpiCard label="10-year Treasury" value={pct(ten?.value ?? null)}
          context={`${ten?.as_of ? fmtDay(ten.as_of) : "—"} · 30d ${fmtPp(ten?.chg_30d_pp ?? null)} · 1y ${fmtPp(ten?.chg_1y_pp ?? null)}`} accent="sky" />
        {cr.bbb_yield?.value != null ? (
          <KpiCard label="BBB corporate bond yield" value={pct(cr.bbb_yield.value)}
            context={`ICE BofA BBB index · spread ${fmtPp(cr.bbb_oas?.value ?? null)} · 1y ${fmtPp(cr.bbb_yield.chg_1y)} · ${cr.bbb_yield.as_of ? fmtDay(cr.bbb_yield.as_of) : "—"}`}
            accent="violet" />
        ) : (
          <KpiCard label="High-yield OAS" value={fmtPp(cr.hy_oas.value)}
            context={`ICE BofA · 30d ${fmtPp(cr.hy_oas.chg_30d)} · ${cr.hy_oas.as_of ?? "—"}`}
            accent={(cr.hy_oas.chg_30d ?? 0) > 0 ? "red" : "emerald"} />
        )}
        {sofr?.value != null ? (
          <KpiCard label="30-day average SOFR" value={pct(sofr.value)}
            context={`backward-looking compounded base rate, not Term SOFR · 1y ${fmtPp(sofr.chg_1y)} · ${sofr.as_of ? fmtDay(sofr.as_of) : "—"}`} accent="amber" />
        ) : (
          <KpiCard label="10y real yield" value={fmtPp(s.real_10y.value)}
            context={`DGS10 − 10y breakeven ${pct(data.breakevens.t10yie.value)}`} accent="violet" />
        )}
        <KpiCard label="2s10s" value={fmtPp(s.s2s10s.value)}
          context={`${s.s2s10s.value != null && s.s2s10s.value < 0 ? "inverted · " : ""}2y ${pct(two?.value ?? null)} · 30d ${fmtPp(s.s2s10s.chg_30d_pp)}`}
          accent={s.s2s10s.value != null && s.s2s10s.value < 0 ? "red" : "emerald"} />
      </div>
      <Citation series="10-year Treasury yield (DGS10)" asOf={ten?.as_of ?? data.published_at.slice(0, 10)} value={pct(ten?.value ?? null)} path="/rates" />

      <Section title="The curve — today vs 30 days and a year ago" featured>
        <div className="section-tools">
          <DownloadData filename="macrogauge-treasury-curve" json="rates.json" spec={RATES_CURVE_CSV}
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

      {data.fed_path && <FedPathSection fp={data.fed_path} />}

      <Section title="Spreads — 2s10s, 3m10y and the real 10-year, since 2019">
        <div className="section-tools">
          <DownloadData filename="macrogauge-rates-history" json="rates.json"
            citation="MacroGauge rates history (daily, DGS10 business-day grid)"
            spec={RATES_HISTORY_CSV} />
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

      <Section title="Credit spreads, inflation compensation and the dollar">
        {/* GDPNow and the auto-loan rate left this board (2026-10-07): neither
            is a cost of capital for a build; both stay in rates.json */}
        <div className="quote-board">
          {([
            ["IG OAS", cr.ig_oas, "pp"],
            ["BBB OAS", cr.bbb_oas, "pp"],
            ["HY OAS", cr.hy_oas, "pp"],
            ["5y breakeven", data.breakevens.t5yie, "pp"],
            ["10y breakeven", data.breakevens.t10yie, "pp"],
            ["Broad dollar", data.dollar, "%"],
          ] as [string, Rates["dollar"] | undefined, "pp" | "%"][]).filter(([, L]) => L).map(([label, L, unit]) => (
            <div className="quote-tile rt-tile" key={L!.code}>
              <div className="quote-label">{label}</div>
              <div className="rt-tile-value">
                {L!.value == null ? "—" : unit === "%" ? L!.value.toFixed(1) : `${L!.value.toFixed(2)}%`}
              </div>
              {/* a block, not the flex .quote-meta: flex split every bare
                  text node ("30d", "·", "1y") into its own floating item */}
              <div className="rt-tile-meta">
                <span>30d <Chg v={L!.chg_30d} unit={unit} /></span>
                <span>1y <Chg v={L!.chg_1y} unit={unit} /></span>
                <small>{L!.as_of ? fmtDay(L!.as_of) : "—"}</small>
              </div>
              <TailSpark tail={L!.tail.values} label={label} />
            </div>
          ))}
        </div>
        <div className="chart-card" style={{ marginTop: 10 }}>
          <LinesChart height={280} refLine={2} refLabel="2%"
            series={[
              { name: "10y breakeven", x: cut(h.dates), y: cut(h.t10yie), color: C.sky },
              { name: "5y breakeven", x: cut(h.dates), y: cut(h.t5yie), color: C.violet, dashed: true },
              { name: "HY OAS", x: cut(h.dates), y: cut(h.hy_oas), color: C.red },
              ...(h.bbb_oas ? [{ name: "BBB OAS", x: cut(h.dates), y: cut(h.bbb_oas), color: C.amber }] : []),
              ...(h.ig_oas ? [{ name: "IG OAS", x: cut(h.dates), y: cut(h.ig_oas), color: C.emerald, dashed: true }] : []),
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
            spec={RATES_LIQUIDITY_CSV} />
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
