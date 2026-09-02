export type StatusTone = "ok" | "advisory" | "critical";

export function StatusPill({
  ok,
  label,
  tone,
}: {
  ok: boolean;
  label: string;
  tone?: StatusTone;
}) {
  const resolvedTone = tone ?? (ok ? "ok" : "critical");
  return (
    <span className={`status-pill status-pill-${resolvedTone}`}>
      <span className="status-pill-dot" />
      {label}
    </span>
  );
}
