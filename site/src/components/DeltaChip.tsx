import { fmtPp, fmtSigned, yoyColor } from "@/lib/format";

/** `pp` renders percentage-point deltas (2dp, "pp") instead of % (1dp). */
export function DeltaChip({
  value,
  prefix,
  pp = false,
}: {
  value: number | null;
  prefix?: string;
  pp?: boolean;
}) {
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
      {pp ? fmtPp(value) : fmtSigned(value)}
    </span>
  );
}
