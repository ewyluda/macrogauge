export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  const color = ok ? "var(--accent-emerald)" : "var(--accent-red)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}
