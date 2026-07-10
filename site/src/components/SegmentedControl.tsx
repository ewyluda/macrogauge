"use client";

/** Chip-style segmented control (Treemap-chip idiom, generalized). */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              border: `1px solid ${active ? "rgba(56,189,248,0.5)" : "var(--border)"}`,
              background: active ? "rgba(56,189,248,0.12)" : "var(--chip-bg)",
              color: active ? "var(--accent-sky)" : "var(--muted)",
              borderRadius: 999,
              padding: "2px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
