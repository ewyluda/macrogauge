"use client";
import type { Capacity } from "@/lib/types";

export function DemandMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  return <p style={{ color: "var(--muted)" }}>Demand map — coming in the next commit ({data.tenants.length} tenant links, {visible.size} companies visible).</p>;
}
