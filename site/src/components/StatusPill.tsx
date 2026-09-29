export type StatusTone = "ok" | "advisory" | "critical";

// A glyph and a spoken word per tone, so status never rides on colour alone
// (review 2026-09-01 B14): the glyph is decorative for sighted readers, the
// sr-only word is what a screen reader announces ahead of the label.
const TONE_GLYPH: Record<StatusTone, string> = { ok: "✓", advisory: "!", critical: "✕" };
const TONE_WORD: Record<StatusTone, string> = { ok: "OK", advisory: "Advisory", critical: "Critical" };

/** Severity-coloured pill. `tone` is required so a caller has to decide
 *  whether a failure is advisory or critical: connector errors are advisory
 *  (the pipeline's `connectors_ok` check is `critical: False`), and only the
 *  QA checks the pipeline itself marks critical earn red (C6). */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`status-pill status-pill-${tone}`}>
      <span className="status-pill-icon" aria-hidden="true">{TONE_GLYPH[tone]}</span>
      <span className="sr-only">{TONE_WORD[tone]}: </span>
      {label}
    </span>
  );
}
