import { KpiCard } from "@/components/KpiCard";
import { fmtSigned } from "@/lib/format";
import {
  BASIS_LABEL, PERIOD_LABEL, SCOPE_LABEL, label, peerMatrix, type Peer,
} from "@/lib/peerRows";

export type ContextData = {
  colo: { rate_kw_mo: number; yoy_pct: number; vacancy_pct: number;
          under_construction_gw: number; asof: string; source: string };
  queue: { generation_gw: number; storage_gw: number; asof: string; source: string };
  peers: Peer[];
  transformer: { weeks: number; asof: string; source: string } | null;
  kalshi: { dc_count_expected: number | null; count_asof: string | null;
            nuclear_by_2030_prob: number | null; nuclear_asof: string | null } | null;
  diesel: { latest: number; asof: string; unit: string } | null;
  water: { yoy_pct: number | null; asof: string } | null;
};

export function ContextPanel({ context }: { context: ContextData }) {
  const { colo, queue, peers, transformer, kalshi, diesel, water } = context;
  const { years, cells, ours } = peerMatrix(peers);
  return (
    <>
      <h2>The bigger picture <span className="subtitle">demand, scarcity & external checks</span></h2>
      <div className="kpi-row">
        <KpiCard label="Colo asking rate" value={`$${colo.rate_kw_mo.toFixed(2)}/kW-mo`}
                 context={`${fmtSigned(colo.yoy_pct)} YoY · vacancy ${colo.vacancy_pct}% · ${colo.asof}`}
                 accent="sky" />
        <KpiCard label="Grid queue" value={`${queue.generation_gw.toLocaleString()} GW`}
                 context={`+${queue.storage_gw.toLocaleString()} GW storage queued · ${queue.asof}`}
                 accent="violet" />
        {diesel && (
          <KpiCard label="Diesel (genset fuel)" value={`$${diesel.latest.toFixed(2)}/gal`}
                   context={`US retail weekly · as of ${diesel.asof}`} accent="amber" />
        )}
        {water && water.yoy_pct != null && (
          <KpiCard label="Water, sewer & trash CPI" value={fmtSigned(water.yoy_pct)}
                   context={`cooling input · as of ${water.asof}`} accent="emerald" />
        )}
        {transformer && (
          <KpiCard label="Transformer lead time" value={`~${transformer.weeks} wk`}
                   context={`${transformer.source} · ${transformer.asof}`} accent="red" />
        )}
      </div>
      {kalshi && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
          {kalshi.dc_count_expected != null && (
            <span className="badge badge-muted">
              market-implied 2026 US data centers: ~{Math.round(kalshi.dc_count_expected).toLocaleString()} · Kalshi · {kalshi.count_asof}
            </span>
          )}
          {kalshi.nuclear_by_2030_prob != null && (
            <span className="badge badge-muted">
              military-base nuclear DC by 2030: {(kalshi.nuclear_by_2030_prob * 100).toFixed(0)}% odds · Kalshi · {kalshi.nuclear_asof}
            </span>
          )}
        </div>
      )}
      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Year</th>
              {peers.map((p) => (
                <th key={p.key} title={p.caveat}>
                  <span style={headerStack}>
                    <span>{p.short}</span>
                    <span style={badgeRow}>
                      <span className="badge badge-muted">{label(BASIS_LABEL, p.basis)}</span>
                      <span className="badge badge-muted">{label(SCOPE_LABEL, p.scope)}</span>
                      {p.derived && <span className="badge badge-muted">computed by us</span>}
                    </span>
                  </span>
                </th>
              ))}
              <th>
                <span style={headerStack}>
                  <span>Our DC Build</span>
                  <span style={badgeRow}>
                    <span className="badge">input cost</span>
                    <span className="badge">US data centres</span>
                  </span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map((year, i) => (
              <tr key={year}>
                <td>{year}</td>
                {cells[i].map((v, j) => (
                  <td key={peers[j].key}>{v != null ? fmtSigned(v) : "—"}</td>
                ))}
                <td>{ours[i] != null ? fmtSigned(ours[i] as number) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="method">
          Annual external calibration for a daily index. These peers do not measure the same
          thing we do — an em dash means the publisher printed no figure for that year, never a
          value we filled in. No forecasts: every row is a realised, backward-looking print.
        </p>
        {peers.map((p) => (
          <p className="method" key={p.key}>
            <strong>{p.short}</strong> — {p.firm}, {p.publication} · {p.geography === "us" ? "US" : "global"}
            {" · "}{label(PERIOD_LABEL, p.period_basis)} basis · as of {p.asof}. {p.caveat}
            {" "}<span className="badge badge-muted">{p.source}</span>
          </p>
        ))}
      </div>
    </>
  );
}

const headerStack: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end",
};
const badgeRow: React.CSSProperties = {
  display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end",
  textTransform: "none", letterSpacing: 0,
};
