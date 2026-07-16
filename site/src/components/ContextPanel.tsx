import { KpiCard } from "@/components/KpiCard";
import { fmtSigned } from "@/lib/format";

export type ContextData = {
  colo: { rate_kw_mo: number; yoy_pct: number; vacancy_pct: number;
          under_construction_gw: number; asof: string; source: string };
  queue: { generation_gw: number; storage_gw: number; asof: string; source: string };
  tnt: { rows: { year: number; escalation_pct: number; build_yoy_pct: number | null }[];
         asof: string; source: string };
  transformer: { weeks: number; asof: string; source: string } | null;
  kalshi: { dc_count_expected: number | null; count_asof: string | null;
            nuclear_by_2030_prob: number | null; nuclear_asof: string | null } | null;
  diesel: { latest: number; asof: string; unit: string } | null;
  water: { yoy_pct: number | null; asof: string } | null;
};

export function ContextPanel({ context }: { context: ContextData }) {
  const { colo, queue, tnt, transformer, kalshi, diesel, water } = context;
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
          <thead><tr><th>Year</th><th>T&T $/W escalation</th><th>Our DC Build YoY</th></tr></thead>
          <tbody>
            {tnt.rows.map((r) => (
              <tr key={r.year}>
                <td>{r.year}</td>
                <td>{fmtSigned(r.escalation_pct)}</td>
                <td>{r.build_yoy_pct != null ? fmtSigned(r.build_yoy_pct) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="method">{tnt.source} · as of {tnt.asof} — annual external calibration for a daily index.</p>
      </div>
    </>
  );
}
