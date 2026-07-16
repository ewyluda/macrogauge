import { KpiCard, type Accent } from "@/components/KpiCard";

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
  tail: { active: boolean; smooth_days: number | null; hubs: string[] };
  hubs: PowerHub[];
  henry_hub: PowerHub | null;
  capacity_auction: {
    source: string;
    asof: string;
    rows: PowerCapacityRow[];
  };
};

// Order matches publish order (CAISO SP15, MISO Indiana Hub, PJM Western Hub
// via ICE) — three hub cards, accents assigned positionally.
const HUB_ACCENTS: Accent[] = ["sky", "violet", "amber"];

export function PowerPanel({ power }: { power: PowerData }) {
  const { hubs, henry_hub, capacity_auction } = power;
  const rows = capacity_auction.rows;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const multiple =
    first && last && first.price_mw_day > 0
      ? last.price_mw_day / first.price_mw_day
      : null;
  const yearsSpan =
    first && last
      ? parseInt(last.delivery_year.slice(0, 4), 10) -
        parseInt(first.delivery_year.slice(0, 4), 10)
      : null;
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
          {multiple !== null && yearsSpan !== null && (
            <>
              {" "}
              — PJM capacity clearing prices rose ~{Math.floor(multiple)}× from{" "}
              {first.delivery_year} to {last.delivery_year} ({yearsSpan} years).
            </>
          )}
        </p>
      </div>
    </>
  );
}
