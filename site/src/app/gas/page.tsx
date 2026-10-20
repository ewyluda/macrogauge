import type { Metadata } from "next";
import Link from "next/link";
import gasJson from "../../../public/data/gas.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { LinesChart } from "@/components/LinesChart";
import { DownloadData } from "@/components/DownloadData";
import { Citation } from "@/components/Citation";
import { StaleBanner } from "@/components/StaleBanner";
import { artifact } from "@/lib/artifact";
import { C } from "@/lib/chartTheme";
import { columnsToRows } from "@/lib/csv";
import { fmtDay, fmtMonth, fmtSigned, yoyColor } from "@/lib/format";
import { gasHeadline } from "@/lib/gasHeadline";

// 2026-10-19: gas is the fuel behind most of the power an AI campus buys and
// a growing share of what it builds for itself, so it sits beside Power &
// Tariffs. The page computes nothing — every figure is in gas.json.
const data = artifact("gas", gasJson);
const hh = data.henry_hub;
const fut = data.futures;
const st = data.storage;
const dem = data.demand;
const fc = data.fuel_cost;
const ai = data.ai_gas_deals;
const hubs = data.power_vs_gas ?? [];
const fwd = data.outlook;
const headline = gasHeadline(hh, hubs);

const usd = (v: number | null | undefined, d = 2) => (v == null ? "—" : `$${v.toFixed(d)}`);
const int = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const num = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
const STATUS: Record<string, string> = { signed: "Signed", pending: "Pending", option: "Option", mou: "MOU", loi: "LOI" };

export const metadata: Metadata = {
  title: `Natural Gas: ${headline?.title ?? "Henry Hub, storage, power burn and the fuel behind AI power"}`,
  description:
    "Henry Hub gas, storage against the five-year average, power-sector burn and LNG exports, each power hub's price against gas over the same 30 days, and what gas-fired AI power burns — each figure from EIA or the market, dated.",
};

export default function GasPage() {
  const h = data.history;
  const shownHubs = hubs.filter((r) => r.ratio != null);
  return (
    <div className="datacenter-dashboard">
      <StaleBanner publishedAt={data.published_at} />
      <header className="research-intro">
        <div className="research-eyebrow">AI infrastructure · Natural gas <span>Updated {fmtDay(data.published_at.slice(0, 10))}</span></div>
        <h1>{headline?.title ?? "Natural Gas"}</h1>
        <p data-testid="gas-takeaway">
          {headline?.detail ?? "Gas sets the price of most US power and fuels a growing share of what AI campuses build for themselves."}{" "}
          Part of the <Link href="/datacenter">Data Center Cost Index</Link> family, beside <Link href="/power">Power &amp; Tariffs</Link>.
        </p>
      </header>

      <div className="kpi-row">
        <KpiCard label="Henry Hub spot, $/MMBtu" value={hh ? usd(hh.latest) : "—"}
          context={hh ? `${fmtDay(hh.as_of)} · 30-day avg ${usd(hh.avg30)}, ${fmtSigned(hh.avg30_yoy_pct)} on the year` : "unavailable in this publish"}
          accent="amber" />
        <KpiCard label="Front-month futures, $/MMBtu" value={fut ? usd(fut.latest) : "—"}
          context={fut ? `NYMEX · ${fmtDay(fut.as_of)} · ${fut.vs_spot == null ? "" : `${fut.vs_spot >= 0 ? "+" : "−"}$${Math.abs(fut.vs_spot).toFixed(2)} vs spot · `}1y ${fmtSigned(fut.chg_1y_pct)}` : "unavailable in this publish"}
          accent="violet" />
        <KpiCard label="Gas in storage" value={st ? `${int(st.bcf)} Bcf` : "—"}
          context={st ? `week to ${fmtDay(st.as_of)} · ${fmtSigned(st.vs_avg5_pct)} vs 5-yr avg · ${fmtSigned(st.vs_year_ago_pct)} vs a year ago` : "unavailable in this publish"}
          accent={st?.vs_avg5_pct != null && st.vs_avg5_pct < 0 ? "red" : "emerald"} />
        <KpiCard label="Power-sector burn, 12 months" value={dem?.power_burn?.ttm_bcf_d != null ? `${num(dem.power_burn.ttm_bcf_d)} Bcf/d` : "—"}
          context={dem?.power_burn ? `${fmtSigned(dem.power_burn.ttm_yoy_pct)} vs the 12 before · through ${fmtMonth(dem.power_burn.as_of)}` : "unavailable in this publish"}
          accent="sky" />
      </div>
      {hh && (
        <div className="page-asof">
          <Citation series="Henry Hub natural gas spot (EIA)" asOf={hh.as_of} value={`${usd(hh.latest)}/MMBtu`} path="/gas" />
        </div>
      )}

      {shownHubs.length > 0 && (
        <Section title="Power vs Henry Hub: each hub's price against gas" id="power-vs-gas" featured>
          <p className="method">
            Each hub&apos;s 30-day average power price divided by Henry Hub&apos;s average over the same 30 days, now
            and a year earlier: the MMBtu of Henry Hub gas a megawatt-hour is worth. A combined-cycle plant burns
            about {num(data.cc_mmbtu_per_mwh, 1)} MMBtu per MWh, so a hub near that clears close to its fuel cost at
            Henry Hub prices. A ratio well above it, or rising, means power moved more than Henry Hub did. The table
            can&apos;t say why: local gas trading above Henry Hub, less efficient plants setting the price, and
            scarcity or congestion all look the same here.
          </p>
          <div className="table-card">
            <table className="data-table" data-testid="gas-hub-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Hub</th>
                  <th>Power, 30-day avg</th><th>Power YoY</th>
                  <th>Henry Hub, same days</th><th>Gas YoY</th>
                  <th>MMBtu per MWh</th><th>A year ago</th><th>× CC fuel</th>
                </tr>
              </thead>
              <tbody>
                {shownHubs.map((r) => (
                  <tr key={r.code}>
                    <td style={{ textAlign: "left" }} className="cell-prose">
                      <strong>{r.label}</strong>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>{r.product} · to {fmtDay(r.as_of)}</div>
                    </td>
                    <td>{usd(r.power_avg30)}/MWh</td>
                    <td style={{ color: yoyColor(r.power_yoy_pct) }}>{fmtSigned(r.power_yoy_pct)}</td>
                    <td>{usd(r.gas_avg30)}</td>
                    <td style={{ color: yoyColor(r.gas_yoy_pct) }}>{fmtSigned(r.gas_yoy_pct)}</td>
                    <td><strong>{num(r.ratio)}</strong></td>
                    <td>{num(r.ratio_year_ago)}</td>
                    <td>{r.vs_cc_fuel == null ? "—" : `${r.vs_cc_fuel.toFixed(1)}×`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="method">
            Two cautions. This is Henry Hub, not each hub&apos;s local gas: Texas and Appalachian gas often trade below
            it and New England&apos;s far above it in winter, so read each row against its own year-ago ratio rather
            than against other rows. And on-peak products (the ICE rows) run higher than all-hours averages. Power
            prices are the same ones <Link href="/power">Power &amp; Tariffs</Link> shows.
          </p>
        </Section>
      )}

      <Section title="Henry Hub since 2018, and EIA's forecast path" id="henry-hub">
        <div className="section-tools">
          <DownloadData filename="macrogauge-henry-hub" json="gas.json"
            citation={`Henry Hub natural gas spot (EIA), daily, through ${hh?.as_of ?? "—"}`}
            rows={columnsToRows({ name: "date", values: h.dates }, [{ name: "henry_hub_usd_mmbtu", values: h.henry_hub }])} />
        </div>
        <div className="chart-card">
          <LinesChart height={300} yUnit="" yPrefix="$" ariaTitle="Henry Hub natural gas spot, $/MMBtu, daily since 2018, with EIA's monthly forecast"
            series={[
              { name: "Henry Hub spot ($/MMBtu)", x: h.dates, y: h.henry_hub, color: C.amber, width: 1.5 },
              ...(fwd && !fwd.stale ? [{ name: "EIA STEO forecast (monthly avg)", x: fwd.months, y: fwd.values, color: C.violet, dashed: true }] : []),
            ]} />
        </div>
        <p className="method">
          {hh ? <>The last year ran from {usd(hh.low_52w)} to {usd(hh.high_52w)}: gas is cheap most days and spikes when cold
          snaps outrun pipelines. </> : null}
          {fwd && !fwd.stale && fwd.next12_avg != null ? (
            <>EIA&apos;s Short-Term Energy Outlook (received {fmtDay(fwd.release_seen)}) puts Henry Hub at an average of{" "}
              {usd(fwd.next12_avg)} from {fmtMonth(fwd.next12_from)} to {fmtMonth(fwd.next12_to)}. That is EIA&apos;s
              forecast, not ours.</>
          ) : fwd?.stale ? <>EIA&apos;s forecast is left off because its latest release here is from {fmtDay(fwd.release_seen)}.</> : null}
        </p>
      </Section>

      {fc && (
        <Section title="If a campus burns its own gas: the fuel bill" id="fuel-bill">
          <p className="method">
            What the fuel alone costs per megawatt-hour at Henry Hub&apos;s 30-day average of {usd(fc.gas_price)}/MMBtu
            {fc.forward_price != null ? <> and at EIA&apos;s next-12-month average of {usd(fc.forward_price)}</> : null},
            for the three kinds of gas plant behind most on-site and utility-built AI power.
          </p>
          <div className="table-card">
            <table className="data-table" data-testid="gas-fuel-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Plant type</th><th>Heat rate (Btu/kWh)</th>
                  <th>Fuel $/MWh now</th>{fc.forward_price != null && <th>At EIA&apos;s path</th>}
                  <th>Per MW-year, full output</th><th>Each +$1/MMBtu adds</th>
                </tr>
              </thead>
              <tbody>
                {fc.heat_rates.map((r) => (
                  <tr key={r.key}>
                    <td style={{ textAlign: "left" }}>{r.label}</td>
                    <td>{int(r.btu_per_kwh)}</td>
                    <td><strong>{usd(r.fuel_usd_mwh)}</strong></td>
                    {fc.forward_price != null && <td>{usd(r.fuel_usd_mwh_forward)}</td>}
                    <td>${int(r.usd_per_mw_year)}</td>
                    <td>{usd(r.per_dollar_usd_mwh)}/MWh · ${int(r.per_dollar_usd_per_mw_year)}/MW-yr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="method">
            Heat rates are EIA&apos;s {fc.heat_rates[0]?.year} average tested full-load rates for natural-gas units by
            prime mover (<a href={fc.heat_rates[0]?.source_url}>Electric Power Annual, Table 8.2</a>); units at part load
            burn more. This is fuel only — no plant capital, operations, pipeline charges or local basis — so it is a
            floor under self-generation, not its cost, and not comparable one-for-one with the all-in hub prices above.
          </p>
        </Section>
      )}

      {ai && ai.deals.length > 0 && (
        <Section title="The gas behind AI power deals" id="ai-gas">
          <div className="kpi-row">
            <KpiCard label="Gas plants behind signed deals" value={`${int(ai.signed_gas_mw)} MW`}
              context={`up to ${num(ai.signed_bcf_d, 2)} Bcf/d at full output${ai.signed_share_of_power_burn_pct != null ? ` · ${num(ai.signed_share_of_power_burn_pct)}% of US power burn` : ""}` +
                (ai.signed_unstated_mw > 0 ? ` · plus ${int(ai.signed_unstated_mw)} MW of signed deals with no gas share stated` : "")}
              accent="amber" />
            <KpiCard label="Pending, options and MOUs" value={`${int(ai.other_gas_mw)} MW`}
              context={`of gas plants · up to ${num(ai.other_bcf_d, 2)} Bcf/d more${ai.all_share_of_power_burn_pct != null ? ` · ${num(ai.all_share_of_power_burn_pct)}% of power burn with signed` : ""}` +
                (ai.other_unstated_mw > 0 ? ` · plus ${int(ai.other_unstated_mw)} MW with no gas share stated` : "")}
              accent="violet" />
          </div>
          <div className="table-card">
            <table className="data-table" data-testid="gas-deals-table">
              <thead>
                <tr><th style={{ textAlign: "left" }}>Company</th><th style={{ textAlign: "left" }}>Supplier and plant</th><th>Deal MW</th><th>Gas plant MW</th><th>Status</th><th>Bcf/d at full output</th></tr>
              </thead>
              <tbody>
                {ai.deals.map((d) => (
                  <tr key={`${d.t}-${d.facility}`}>
                    <td style={{ textAlign: "left" }}><strong>{d.t}</strong></td>
                    <td style={{ textAlign: "left" }} className="cell-prose">
                      <a href={d.source_url}>{d.counterparty}</a>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>{d.facility}</div>
                    </td>
                    <td>{int(d.mw)}<div style={{ color: "var(--muted)", fontSize: 11 }}>{d.mw_basis}</div></td>
                    <td>{d.gas_mw != null ? int(d.gas_mw) : (
                      <>not stated{d.gas_mw_note && <div className="cell-prose" style={{ color: "var(--muted)", fontSize: 11 }}>{d.gas_mw_note}</div>}</>
                    )}</td>
                    <td>{STATUS[d.status] ?? d.status}</td>
                    <td>{num(d.bcf_d_full_output, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="method">
            The gas-fired deals from the <Link href="/capacity#power-deals">power deals tracker</Link> (curated{" "}
            {fmtDay(ai.as_of_curated)}). A deal&apos;s MW can be contracted load or a bundle of gas, batteries and market
            purchases, so burn uses only the gas plant&apos;s own stated MW, quoted from the deal&apos;s source; where the
            source gives no gas share, no burn is computed. Burn assumes every gas megawatt runs around the clock on a combined cycle&apos;s{" "}
            {int(ai.btu_per_kwh)} Btu/kWh and {int(ai.btu_per_cf)} Btu per cubic foot of gas (EIA, {ai.heat_content_year}):
            more hours than any plant runs, less fuel than turbines and engines burn. Read it as the scale of the
            commitment, not a forecast. The share is of the last 12 months of US power-sector burn
            {ai.power_burn_ttm_bcf_d != null ? ` (${num(ai.power_burn_ttm_bcf_d)} Bcf/d)` : ""}. Fuel-cell deals, which
            also run on gas, are not counted.
          </p>
        </Section>
      )}

      {(st || dem) && (
        <Section title="Supply and demand: storage, power burn and LNG" id="balance">
          {st && (
            <>
              <div className="chart-card">
                <LinesChart height={260} recessions={false} yUnit=" Bcf" fitY
                  ariaTitle="Lower-48 working gas in storage, weekly, against the five-year average"
                  series={[
                    { name: "Working gas in storage (Bcf)", x: st.history.dates, y: st.history.bcf, color: C.sky },
                    { name: "Five-year average, same week (Bcf)", x: st.history.dates, y: st.history.avg5_bcf, color: C.muted, dashed: true },
                  ]} />
              </div>
              <p className="method">
                {int(st.bcf)} Bcf in the week to {fmtDay(st.as_of)} ({st.chg_week_bcf == null ? "" : `${st.chg_week_bcf >= 0 ? "+" : "−"}${int(Math.abs(st.chg_week_bcf))} Bcf on the week; `}
                {int(st.avg5_bcf)} Bcf five-year average; {int(st.year_ago_bcf)} Bcf a year ago). The five-year average
                is ours — the same week in each of the five prior years — and tracks, but is not, EIA&apos;s published one.
              </p>
            </>
          )}
          {dem && (
            <>
              <div className="chart-card" style={{ marginTop: 10 }}>
                <LinesChart height={260} recessions={false} yUnit=" Bcf/d"
                  ariaTitle="US natural gas burned for power and exported as LNG, Bcf per day, monthly"
                  series={[
                    { name: "Power-sector burn (Bcf/d)", x: dem.history.months, y: dem.history.power_burn_bcf_d, color: C.amber },
                    { name: "LNG exports (Bcf/d)", x: dem.history.months, y: dem.history.lng_exports_bcf_d, color: C.violet },
                  ]} />
              </div>
              <p className="method">
                {dem.power_burn && <>Power plants burned {num(dem.power_burn.bcf_d)} Bcf/d in {fmtMonth(dem.power_burn.as_of)} ({fmtSigned(dem.power_burn.yoy_pct)} on the year); summer peaks are air conditioning. </>}
                {dem.lng_exports && <>LNG exports ran {num(dem.lng_exports.ttm_bcf_d)} Bcf/d over the last 12 months, {fmtSigned(dem.lng_exports.ttm_yoy_pct)} on the 12 before — a fast-growing
                  claim on the same supply data centers draw on. </>}
                EIA monthly volumes, shown per day so short and long months compare.
              </p>
            </>
          )}
        </Section>
      )}

      <section className="dc-section dc-method" aria-labelledby="gas-method-title">
        <h2 id="gas-method-title">How it&apos;s built</h2>
        <p className="method">
          Henry Hub spot is EIA&apos;s daily series (a few days behind); the front month is the NYMEX contract via FMP.
          Storage is EIA&apos;s weekly Lower-48 working gas; power burn and LNG exports are EIA&apos;s monthly volumes,
          about three months behind. EIA&apos;s Short-Term Energy Outlook supplies the forecast path and is dropped
          once its latest release here is more than 45 days old. Every ratio and fuel figure is arithmetic on those
          numbers and the EIA heat rates named above; nothing here feeds the Data Center Cost Index, whose power
          leg stays on official retail prices.
        </p>
      </section>
    </div>
  );
}
