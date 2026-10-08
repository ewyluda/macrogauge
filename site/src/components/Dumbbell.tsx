import { C } from "@/lib/chartTheme";

/** Two values per row on one shared 0-based axis, joined by a bar — e.g. each
 *  component's CPI weight vs its PCE share. HTML with percentage positions, so
 *  labels stay legible on a phone. Neutral colours: a shift is not good or bad. */
export function Dumbbell({ rows, aLabel, bLabel, fmt, testId }: {
  rows: { key: string; label: string; a: number; b: number }[];
  aLabel: string;
  bLabel: string;
  fmt: (v: number) => string;
  testId?: string;
}) {
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b])) * 1.05 || 1;
  const at = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="chart-card dumbbell" data-testid={testId}>
      <ul aria-label={`${aLabel} vs ${bLabel}`}>
        {rows.map((r) => (
          <li key={r.key} className="dumbbell-row">
            <span className="dumbbell-label">{r.label}</span>
            <span className="dumbbell-track" aria-label={`${r.label}: ${aLabel} ${fmt(r.a)}, ${bLabel} ${fmt(r.b)}`} role="img">
              <span className="dumbbell-bar" style={{ left: at(Math.min(r.a, r.b)), width: `calc(${at(Math.abs(r.b - r.a))})` }} />
              <span className="dumbbell-dot" style={{ left: at(r.a), background: C.amber }} />
              <span className="dumbbell-dot" style={{ left: at(r.b), background: C.sky }} />
            </span>
            <span className="dumbbell-vals">{fmt(r.a)} → {fmt(r.b)}</span>
          </li>
        ))}
      </ul>
      <p className="method" style={{ margin: "8px 0 0", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span><span aria-hidden className="dumbbell-key" style={{ background: C.amber }} />{aLabel}</span>
        <span><span aria-hidden className="dumbbell-key" style={{ background: C.sky }} />{bLabel}</span>
      </p>
    </div>
  );
}
