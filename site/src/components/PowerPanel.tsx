import { KpiCard } from "./KpiCard";
import { fmtDay, fmtSigned } from "@/lib/format";
import { capacityMarkets, type PowerSummary } from "@/lib/dcHub";
import { HubMap } from "./HubMap";

export type PowerHub = {
  code: string;
  label: string;
  latest: number;
  asof: string;
  unit: string;
  grid?: string;
  region?: string;
  product?: string;
  avg30?: number | null;
  avg30_yoy_pct?: number | null;
  // [date, $/MWh] pairs; a JSON import widens the tuple, so accept that shape
  spark?: (string | number)[][];
};

export type PowerCapacityRow = {
  delivery_year: string;
  price_mw_day: number;
};

export type CapacityMarket = {
  iso: string;
  name: string;
  product: string;
  status: "auction" | "none";
  note: string;
  source: string;
  source_url: string;
  asof: string;
  rows: { period: string; price_mw_day: number; native?: string }[];
};

export type LargeLoadTariff = {
  utility: string;
  state: string;
  grid: string;
  tariff: string;
  status: string;
  min_take: string;
  term: string;
  threshold: string;
  pipeline: string;
  source: string;
  source_url: string;
  asof: string;
  confidence: "filed" | "press";
};

export type PowerData = {
  tail: {
    active: boolean; smooth_days: number | null; hubs: string[];
    transform?: string; passthrough?: number | null;
    nowcast?: { implied_cents_kwh: number | null; yoy_pct: number | null; asof: string };
  };
  hubs: PowerHub[];
  henry_hub: PowerHub | null;
  capacity_auction: {
    source: string;
    asof: string;
    rows: PowerCapacityRow[];
    multiple?: number | null;
    years_span?: number | null;
  };
  capacity_markets?: CapacityMarket[];
  tariffs?: LargeLoadTariff[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
// Hub dates drop the year unless a print is from an earlier year than the
// freshest hub — "Oct 1" must never pass for this year when it isn't.
const hubDate = (d: string, newestYear: string) =>
  d.slice(0, 4) === newestYear ? fmtDate(d) : `${fmtDate(d)}, ${d.slice(0, 4)}`;
const usd = (v: number) => `$${v.toFixed(2)}`;

/** Inline sparkline: the hub's last 180 days, its own min–max scale. */
function Spark({ pts: raw }: { pts: (string | number)[][] }) {
  const pts = raw.map((p) => [String(p[0]), Number(p[1])] as const);
  if (pts.length < 2) return <span className="pw-spark-empty">—</span>;
  const W = 140, H = 30, vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  return (
    <svg className="pw-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <path d={d} />
      <circle cx={x(pts.length - 1)} cy={y(vals[vals.length - 1])} r="2.5" />
    </svg>
  );
}

function CapacityChart({ markets }: { markets: CapacityMarket[] }) {
  const auctions = markets.filter((m) => m.status === "auction" && m.rows.length);
  const none = markets.filter((m) => m.status === "none");
  const max = Math.max(...auctions.flatMap((m) => m.rows.map((r) => r.price_mw_day)), 1);
  return (
    <>
      <p className="pw-cap-unit">Clearing price, $/MW-day, one scale for every operator.</p>
      <div className="pw-cap-grid">
        {auctions.map((m) => (
          <figure key={m.iso} className="pw-cap">
            <figcaption>
              <strong>{m.iso}</strong> <span>{m.name}</span>
            </figcaption>
            <ol className="pw-cap-bars" aria-label={`${m.iso} capacity clearing price by period`}>
              {m.rows.map((r) => (
                <li key={r.period} title={r.native ? `${r.period}: ${r.native}` : undefined}
                    aria-label={`${r.period}: $${Math.round(r.price_mw_day).toLocaleString("en-US")} per MW-day`}>
                  <span className="pw-cap-val">${Math.round(r.price_mw_day).toLocaleString("en-US")}</span>
                  <span className="pw-cap-bar" style={{ height: `${Math.max(2, (r.price_mw_day / max) * 100)}%` }} />
                  <span className="pw-cap-period">{r.period}</span>
                </li>
              ))}
            </ol>
            <p className="pw-cap-note">{m.product} · <a href={m.source_url} target="_blank" rel="noreferrer">{m.source}</a>, {m.asof}{m.note ? ` · ${m.note}` : ""}</p>
          </figure>
        ))}
      </div>
      {none.length > 0 && (
        <ul className="pw-cap-none">
          {none.map((m) => (
            <li key={m.iso}>
              <strong>{m.iso}</strong> {m.note} <a href={m.source_url} target="_blank" rel="noreferrer">{m.source}</a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The three power readings shown on /power and the /datacenter hub. Each
 *  carries its own date: hubs refresh on different cadences. */
export function PowerKpis({ sum }: { sum: PowerSummary }) {
  const { hub, capacity, tariffs } = sum;
  if (!hub && !capacity && !tariffs) return null;
  return (
    <div className="kpi-row">
      {hub && (
        <KpiCard label={`${hub.label} · 30-day avg`}
          value={hub.avg30 != null ? `$${hub.avg30.toFixed(2)}/MWh` : "—"}
          context={`${fmtSigned(hub.avg30_yoy_pct ?? null)} vs a year earlier · 30 days to ${fmtDay(hub.asof)}`} accent="red" />
      )}
      {capacity && (
        <KpiCard label={`${capacity.iso} capacity · ${capacity.period}`}
          value={`$${Math.round(capacity.price).toLocaleString("en-US")}/MW-day`}
          context={`from $${Math.round(capacity.firstPrice).toLocaleString("en-US")} for ${capacity.first}`} accent="violet" />
      )}
      {tariffs > 0 && (
        <KpiCard label="Large-load tariffs" value={String(tariffs)}
          context="minimum bills, terms and pipelines, each from a filing or order" accent="sky" />
      )}
    </div>
  );
}

/** The power bill: wholesale hubs, capacity prices and large-load tariffs —
 *  the body of /power, one h2 per block. */
export function PowerPanel({ power }: { power: PowerData }) {
  const { hubs, henry_hub, capacity_auction } = power;
  const rows = capacity_auction.rows;
  const markets = capacityMarkets(power);
  const tariffs = power.tariffs ?? [];
  const newestYear = hubs.reduce((y, h) => (h.asof.slice(0, 4) > y ? h.asof.slice(0, 4) : y), "0000");
  return (
    <>
      <div className="pw-block" id="pw-wholesale">
        <div className="pw-block-head">
          <h2>Wholesale power across the grid</h2>
          <p>Thirty-day average at each hub, against the same thirty days a year earlier. On-peak ICE trades and all-hours day-ahead averages measure different things, so compare each hub with its own history rather than across rows.</p>
        </div>
        <HubMap hubs={hubs} />
        <div className="table-card pw-hubs">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Hub</th>
                <th scope="col" className="num">30-day avg</th>
                <th scope="col" className="num">vs year ago</th>
                <th scope="col" className="num">Latest</th>
                <th scope="col">Last 6 months</th>
              </tr>
            </thead>
            <tbody>
              {hubs.map((h) => (
                <tr key={h.code}>
                  <td>
                    <span className="pw-hub">
                      {h.grid && <span className="pw-grid">{h.grid}</span>}
                      <span>
                        <strong>{h.label}</strong>
                        <small>{[h.region, h.product].filter(Boolean).join(" · ")}</small>
                      </span>
                    </span>
                  </td>
                  <td className="num pw-big" data-label="30-day avg">{h.avg30 != null ? usd(h.avg30) : "—"}<small>/MWh</small></td>
                  <td data-label="vs year ago" className={`num pw-yoy${h.avg30_yoy_pct == null ? "" : h.avg30_yoy_pct > 0 ? " up" : " down"}`}>
                    {h.avg30_yoy_pct != null ? fmtSigned(h.avg30_yoy_pct) : "—"}
                  </td>
                  <td className="num" data-label="Latest">{usd(h.latest)}<small>{hubDate(h.asof, newestYear)}</small></td>
                  <td><Spark pts={h.spark ?? []} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pw-strip">
          {henry_hub && (
            <div><span>{henry_hub.label}</span><strong>{usd(henry_hub.latest)}/MMBtu</strong><small>{fmtDate(henry_hub.asof)} · the marginal fuel behind most of these prices</small></div>
          )}
          {power.tail.nowcast && (
            <div><span>Wholesale-implied industrial rate</span>
              <strong>{power.tail.nowcast.implied_cents_kwh != null ? `${power.tail.nowcast.implied_cents_kwh.toFixed(2)}¢/kWh` : "—"}</strong>
              <small>like-month nowcast {fmtSigned(power.tail.nowcast.yoy_pct)} YoY · {power.tail.nowcast.asof}</small></div>
          )}
        </div>
      </div>

      <div className="pw-block" id="pw-capacity">
        <div className="pw-block-head">
          <h2>Capacity prices by grid operator</h2>
          <p>
            What grid operators pay to have enough power plants on call, which utilities pass through to large customers.
            {capacity_auction.multiple != null && capacity_auction.years_span != null && (
              <> PJM&apos;s clearing price rose about {Math.round(capacity_auction.multiple)}× from {rows[0].delivery_year} to {rows[rows.length - 1].delivery_year}.</>
            )}
          </p>
        </div>
        <CapacityChart markets={markets} />
      </div>

      {tariffs.length > 0 && (
        <div className="pw-block" id="pw-tariffs">
          <div className="pw-block-head">
            <h2>What the utilities charge data centers</h2>
            <p>Large-load tariffs where most new data-center demand is landing: the minimum share of contracted capacity a customer pays for whether or not it uses it, how long it is locked in, the size at which the tariff applies, and how much load is lined up.</p>
          </div>
          <div className="table-card pw-tariffs">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Utility and tariff</th>
                  <th scope="col">Minimum bill</th>
                  <th scope="col">Term</th>
                  <th scope="col">Applies at</th>
                  <th scope="col">Pipeline</th>
                </tr>
              </thead>
              <tbody>
                {tariffs.map((t) => (
                  <tr key={t.utility}>
                    <td className="pw-t-who">
                      <span className="pw-t-head"><strong>{t.utility}</strong> <span className="pw-grid">{t.grid}</span></span>
                      <span className="pw-t-tariff">{t.tariff} · {t.state}</span>
                      <span className="pw-t-status">{t.status}</span>
                      <span className="pw-t-src">
                        <a href={t.source_url} target="_blank" rel="noreferrer">{t.source}</a>, {fmtDate(t.asof)}, {t.asof.slice(0, 4)}
                        {t.confidence === "press" && " · press report"}
                      </span>
                    </td>
                    <td data-label="Minimum bill">{t.min_take}</td>
                    <td data-label="Term">{t.term}</td>
                    <td data-label="Applies at">{t.threshold}</td>
                    <td data-label="Pipeline">{t.pipeline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
