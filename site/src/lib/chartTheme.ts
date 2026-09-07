// Canvas can't read CSS custom properties — these hexes MIRROR globals.css.
// If a token changes there, change it here.
export const C = {
  bg: "#F6F7F9",
  card: "#FFFFFF",
  border: "#DEE3E9",
  text: "#17212B",
  muted: "#526170",
  sky: "#2763C4",
  amber: "#9A6210",
  red: "#BB4545",
  emerald: "#147A63",
  violet: "#7356A8",
  // reserved for the col (cost-of-living) variant line — deliberately not one
  // of the semantic accents (sky = ours, amber = official)
  col: "#B86A2D",
} as const;

/** NBER recessions inside the 2018→now window (peak month → trough month). */
export const NBER_RECESSIONS: [string, string][] = [["2020-02-01", "2020-04-30"]];

/** Shared research chart chrome: restrained series colors and light surfaces. */
export function baseOption() {
  return {
    backgroundColor: "transparent",
    textStyle: { color: C.muted, fontSize: 12 },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: C.card,
      borderColor: C.border,
      textStyle: { color: C.text, fontSize: 12 },
      valueFormatter: (v: unknown) =>
        typeof v === "number" ? `${v.toFixed(2)}%` : "—",
    },
    legend: {
      top: 0,
      textStyle: { color: C.muted, fontSize: 12 },
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
    },
    xAxis: {
      type: "time" as const,
      axisLine: { lineStyle: { color: C.border } },
      axisLabel: { color: C.muted },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { color: C.muted, formatter: "{value}%" },
      splitLine: { lineStyle: { color: C.border } },
    },
  };
}
