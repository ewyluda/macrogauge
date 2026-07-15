import type { CSSProperties, ReactNode } from "react";

// One home for the tinted badge variants — the rgba tints are transcriptions
// of the --accent-* palette and must not be re-typed per page.
const TONES = {
  red: {
    color: "var(--accent-red)",
    borderColor: "rgba(248,113,113,.35)",
    background: "rgba(248,113,113,.1)",
  },
  amber: {
    color: "var(--accent-amber)",
    borderColor: "rgba(245,158,11,.35)",
    background: "rgba(245,158,11,.1)",
  },
  emerald: {
    color: "var(--accent-emerald)",
    borderColor: "rgba(52,211,153,.35)",
    background: "rgba(52,211,153,.1)",
  },
} as const;

export type Tone = keyof typeof TONES | "muted";

export function ToneBadge({
  tone,
  children,
  italic = false,
}: {
  tone: Tone;
  children: ReactNode;
  italic?: boolean;
}) {
  const style: CSSProperties | undefined = italic
    ? { fontStyle: "italic" }
    : undefined;
  if (tone === "muted") {
    return (
      <span className="badge badge-muted" style={style}>
        {children}
      </span>
    );
  }
  return (
    <span className="badge" style={{ ...TONES[tone], ...style }}>
      {children}
    </span>
  );
}
