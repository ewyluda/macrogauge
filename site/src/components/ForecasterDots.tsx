import { C } from "@/lib/chartTheme";
import { dotDomain } from "@/lib/cpiPreview";
import type { Forecaster } from "@/lib/types";

const COLOR: Record<string, string> = { Macrogauge: C.sky, Cleveland: C.amber, Kalshi: C.violet };

/** The ensemble's legend from the weights it was built with: equal until
 *  every forecaster earns inverse-MAE weights (nowcast.models). */
export function ensembleLabel(weights: Record<string, number>[]): string {
  const equal = weights.every((w) => {
    const v = Object.values(w);
    return v.every((x) => Math.abs(x - v[0]) < 1e-3);
  });
  return equal ? "equal-weight ensemble" : "ensemble, weighted by past accuracy";
}

/** Each forecaster's call as a dot on one shared MoM axis per target, the
 *  ensemble as a tick — how far apart the calls are, at a glance. HTML with
 *  percentage positions, not a scaled SVG, so the text stays legible on a
 *  phone. */
export function ForecasterDots({ rows }: {
  rows: { label: string; ensemble: number | null; weights: Record<string, number>; forecasters: Forecaster[] }[];
}) {
  const live = rows.filter((r) => r.forecasters.length > 0);
  if (live.length === 0) return null;
  const all = live.flatMap((r) => [...r.forecasters.map((f) => f.value), ...(r.ensemble == null ? [] : [r.ensemble])]);
  const [lo, hi] = dotDomain(all);
  const at = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo * 10) / 10; t <= hi + 1e-9; t += 0.1) ticks.push(Math.round(t * 10) / 10);
  const names = [...new Set(live.flatMap((r) => r.forecasters.map((f) => f.name)))];
  const alt = live.map((r) => `${r.label}: ${r.forecasters.map((f) => `${f.name} ${f.value.toFixed(2)}%`).join(", ")}${r.ensemble == null ? "" : `; ensemble ${r.ensemble.toFixed(2)}%`}`).join(". ");
  return (
    <div className="chart-card fc-dots" data-testid="forecaster-dots">
      <div role="img" aria-label={`Forecaster calls, month over month. ${alt}`}>
        {live.map((r) => (
          <div className="fc-dots-row" key={r.label}>
            <span className="fc-dots-label">{r.label}</span>
            <div className="fc-dots-track">
              {ticks.map((t) => <span key={t} className="fc-dots-grid" style={{ left: at(t) }} />)}
              {r.ensemble != null && <span className="fc-dots-ens" style={{ left: at(r.ensemble) }} />}
              {r.forecasters.map((f) => (
                <span key={f.name} className="fc-dots-dot" title={`${f.name} ${f.value.toFixed(2)}%`}
                  style={{ left: at(f.value), background: COLOR[f.name] ?? C.muted }} />
              ))}
            </div>
          </div>
        ))}
        <div className="fc-dots-row" aria-hidden>
          <span className="fc-dots-label" />
          <div className="fc-dots-axis">
            {ticks.map((t) => <span key={t} style={{ left: at(t) }}>{t.toFixed(1)}%</span>)}
          </div>
        </div>
      </div>
      <p className="method" style={{ margin: "8px 0 0", display: "flex", gap: 14, flexWrap: "wrap" }}>
        {names.map((n) => (
          <span key={n}><span aria-hidden style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: COLOR[n] ?? C.muted, marginRight: 5 }} />{n}</span>
        ))}
        <span><span aria-hidden style={{ display: "inline-block", width: 2, height: 11, background: C.text, marginRight: 5, verticalAlign: "middle" }} />{ensembleLabel(live.map((r) => r.weights))}</span>
      </p>
    </div>
  );
}
