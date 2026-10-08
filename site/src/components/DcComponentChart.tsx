"use client";
import { useMemo } from "react";
import { C } from "@/lib/chartTheme";
import { sliceSince, windowStart } from "@/lib/chartWindow";
import { codecs } from "@/lib/urlState";
import { useUrlState } from "@/lib/useUrlState";
import { CopyLink } from "./CopyLink";
import { LinesChart } from "./LinesChart";
import { SegmentedControl } from "./SegmentedControl";

const VIEWS = [{ key: "yoy", label: "YoY" }, { key: "level", label: "INDEX LEVEL" }] as const;
const WINDOWS = [{ key: "36m", label: "36M" }, { key: "all", label: "ALL" }] as const;

/** One DC index component, monthly, YoY or level, 36 months by default —
 *  the DC counterpart of ComponentChart. */
export function DcComponentChart({ months, levels, yoy, label, rebase }: {
  months: string[]; levels: number[]; yoy: (number | null)[]; label: string; rebase: string;
}) {
  const [view, setView] = useUrlState<"yoy" | "level">("view", "yoy", codecs.enumOf(["yoy", "level"] as const));
  const [win, setWin] = useUrlState<"36m" | "all">("win", "36m", codecs.enumOf(["36m", "all"] as const));
  const cut = useMemo(() => {
    const dates = months.map((m) => `${m}-01`);
    const start = win === "36m" ? windowStart([dates], 36) : undefined;
    return sliceSince<number | null>(dates, [levels, yoy], start);
  }, [months, levels, yoy, win]);
  const level = view === "level";
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "4px 0 8px" }}>
        <SegmentedControl options={VIEWS} value={view} onChange={setView} />
        <SegmentedControl options={WINDOWS} value={win} onChange={setWin} />
        <CopyLink />
      </div>
      <LinesChart height={320} yUnit={level ? "" : "%"} fitY={level} refLine={level ? undefined : 0}
        ariaTitle={`${label}, ${level ? `index level (${rebase})` : "year over year"}`}
        series={[{ name: level ? `${label} (${rebase})` : `${label} YoY`, x: cut.dates, y: level ? cut.series[0] : cut.series[1], color: C.sky }]} />
    </div>
  );
}
