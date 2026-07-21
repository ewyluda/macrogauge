"use client";
import type { CapacityCompany } from "@/lib/types";

export function ValuationScatter({ rows }: { rows: CapacityCompany[] }) {
  return <p style={{ color: "var(--muted)" }}>Valuation × execution — coming in the next commit ({rows.length} rows).</p>;
}
