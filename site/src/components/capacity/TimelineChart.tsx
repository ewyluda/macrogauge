"use client";
import type { CapacityTimeline } from "@/lib/types";

export function TimelineChart({ timeline }: { timeline: CapacityTimeline }) {
  return <p style={{ color: "var(--muted)" }}>Timeline — coming in the next commit ({timeline.points.length} quarters).</p>;
}
