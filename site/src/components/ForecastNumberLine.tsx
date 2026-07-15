// Who's-where strip: every live headline-MoM call positioned on one number
// line, so agreement/disagreement reads at a glance. Pure presentation of
// nextprint.json values — no model math.
export function ForecastNumberLine({
  calls,
}: {
  calls: { name: string; value: number | null }[];
}) {
  const live = calls.filter((c) => c.value != null) as {
    name: string;
    value: number;
  }[];
  if (live.length < 2) return null;

  const sorted = [...live].sort((a, b) => a.value - b.value);
  const min = sorted[0].value;
  const max = sorted[sorted.length - 1].value;
  const spread = max - min;
  // floor the visual span so near-identical calls don't stack on one pixel
  const span = Math.max(spread, 0.05);
  const lo = min - span * 0.2;
  const hi = max + span * 0.2;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2
      ? sorted[mid].value
      : (sorted[mid - 1].value + sorted[mid].value) / 2;

  return (
    <div className="numline-wrap">
      <div className="numline">
        <div className="numline-track" />
        {sorted.map((c, i) => (
          <div
            key={c.name}
            className={i % 2 ? "numline-call numline-below" : "numline-call"}
            style={{ left: `${pos(c.value)}%` }}
          >
            <span className="numline-name">{c.name}</span>
            <span className="numline-dot" />
            <span className="numline-val">{c.value.toFixed(2)}%</span>
          </div>
        ))}
      </div>
      <div className="panel-muted">
        headline MoM calls · median {median.toFixed(2)}% · spread{" "}
        {spread.toFixed(2)}pp
      </div>
    </div>
  );
}
