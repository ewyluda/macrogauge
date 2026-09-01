/** Failure copy for a runtime-fetched artifact — same muted 13px/24px
 *  treatment as the "loading…" placeholders it replaces, so a broken fetch
 *  reads as a state, not a blank. */
export function DataUnavailable({ what }: { what: string }) {
  return (
    <div role="status" style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
      {what} unavailable — reload to retry
    </div>
  );
}
