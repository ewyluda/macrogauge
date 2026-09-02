export type StatusTone = "ok" | "advisory" | "critical";

/** Severity-coloured pill. `tone` is required so a caller has to decide
 *  whether a failure is advisory or critical: connector errors are advisory
 *  (the pipeline's `connectors_ok` check is `critical: False`), and only the
 *  QA checks the pipeline itself marks critical earn red (C6). */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`status-pill status-pill-${tone}`}>
      <span className="status-pill-dot" />
      {label}
    </span>
  );
}
