import { fmtSigned, yoyColor } from "@/lib/format";

export function DeltaChip({ value, prefix }: { value: number | null; prefix?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: "var(--chip-bg)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "1px 8px",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        color: yoyColor(value),
        whiteSpace: "nowrap",
      }}
    >
      {prefix ? `${prefix} ` : ""}
      {fmtSigned(value)}
    </span>
  );
}
