const ACCENTS = {
  sky: "var(--accent-sky)",
  amber: "var(--accent-amber)",
  red: "var(--accent-red)",
  emerald: "var(--accent-emerald)",
  violet: "var(--accent-violet)",
} as const;

export type Accent = keyof typeof ACCENTS;

export function KpiCard({
  label,
  value,
  context,
  accent = "sky",
}: {
  label: string;
  value: string;
  context: string;
  accent?: Accent;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 16,
        minWidth: 220,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 40,
          fontWeight: 700,
          color: ACCENTS[accent],
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{context}</div>
    </div>
  );
}
