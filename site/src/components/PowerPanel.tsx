import { KpiCard, type Accent } from "@/components/KpiCard";
import { fmtSigned } from "@/lib/format";

export type PowerHub = {
  code: string;
  label: string;
  latest: number;
  asof: string;
  unit: string;
};

export type PowerCapacityRow = {
  delivery_year: string;
  price_mw_day: number;
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
};

// Order matches publish order (CAISO SP15, MISO Indiana Hub, PJM Western Hub
// via ICE) — three hub cards, accents assigned positionally.
const HUB_ACCENTS: Accent[] = ["sky", "violet", "amber"];

export function PowerPanel({ power }: { power: PowerData }) {
  const { hubs, henry_hub, capacity_auction } = power;
  const rows = capacity_auction.rows;
  return (
    <>
      <h2>
        The power bill{" "}
        <span className="subtitle">wholesale hubs · fuel · grid capacity</span>
      </h2>
      <div className="kpi-row">
        {hubs.map((h, i) => (
          <KpiCard
            key={h.code}
            label={h.label}
            value={`$${h.latest.toFixed(2)}/MWh`}
            context={`as of ${h.asof}`}
            accent={HUB_ACCENTS[i % HUB_ACCENTS.length]}
          />
        ))}
        {henry_hub && (
          <KpiCard
            label={henry_hub.label}
            value={`$${henry_hub.latest.toFixed(2)}/MMBtu`}
            context={`as of ${henry_hub.asof}`}
            accent="emerald"
          />
        )}
        {power.tail.nowcast && (
          <KpiCard
            label="Wholesale-implied industrial rate"
            value={
              power.tail.nowcast.implied_cents_kwh != null
                ? `${power.tail.nowcast.implied_cents_kwh.toFixed(2)}¢/kWh`
                : "—"
            }
            context={`like-month nowcast ${fmtSigned(power.tail.nowcast.yoy_pct)} YoY · as of ${power.tail.nowcast.asof}`}
            accent="red"
          />
        )}
      </div>
      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Delivery year</th>
              <th>$/MW-day</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.delivery_year}>
                <td>{r.delivery_year}</td>
                <td>${r.price_mw_day.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="method">
          {capacity_auction.source} · as of {capacity_auction.asof}
          {capacity_auction.multiple != null && capacity_auction.years_span != null && (
            <>
              {" "}
              — PJM capacity clearing prices rose ~{Math.floor(capacity_auction.multiple)}× from{" "}
              {rows[0].delivery_year} to {rows[rows.length - 1].delivery_year} (
              {capacity_auction.years_span} years).
            </>
          )}
        </p>
      </div>
    </>
  );
}
