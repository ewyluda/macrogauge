import type { ReactNode } from "react";

/** One-line plain-English explainer under a KPI row — shared by the
 *  composite pages so the matched set can't drift visually. */
export function WhyLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        margin: "12px 2px 4px",
        fontSize: 13.5,
        lineHeight: 1.5,
        color: "var(--muted)",
      }}
    >
      <span style={{ color: "var(--text)", fontWeight: 600 }}>{label}</span>{" "}
      {children}
    </div>
  );
}
