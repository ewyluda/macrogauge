"use client";
import type { Capacity } from "@/lib/types";

export function GeoMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  return <p style={{ color: "var(--muted)" }}>Geo map — coming in the next commit ({data.geo.length} sites, {visible.size} companies visible).</p>;
}
