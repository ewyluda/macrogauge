import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/** Review 2026-09-01 B1: ECharts (tree-shaken `echarts/core`) silently drops
 *  any series type or component that was never passed to `echarts.use`. No
 *  console error, no build error — the feature just doesn't paint. This
 *  audit pins the wrapper's registration list to the option keys the chart
 *  components in this tree actually use, so a new `markLine`/`dataZoom`/bar
 *  series cannot ship unregistered again. */

const COMPONENTS_DIR = path.resolve(__dirname);
const ECHART_WRAPPER = readFileSync(path.join(COMPONENTS_DIR, "EChart.tsx"), "utf8");
const ECHART_CLIENT = readFileSync(path.join(COMPONENTS_DIR, "EChartClient.tsx"), "utf8");

// option key regex -> the echarts module that must be registered for it
const FEATURES: [string, RegExp, string][] = [
  ["markLine", /\bmarkLine\s*:/, "MarkLineComponent"],
  ["markArea", /\bmarkArea\s*:/, "MarkAreaComponent"],
  ["dataZoom", /\bdataZoom\s*:/, "DataZoomComponent"],
  ["visualMap", /\bvisualMap\s*:/, "VisualMapComponent"],
  ["toolbox", /\btoolbox\s*:/, "ToolboxComponent"],
  ["tooltip", /\btooltip\s*:/, "TooltipComponent"],
  ["legend", /\blegend\s*:/, "LegendComponent"],
  ["grid", /\bgrid\s*:/, "GridComponent"],
  ['type: "line"', /type:\s*"line"/, "LineChart"],
  ['type: "bar"', /type:\s*"bar"/, "BarChart"],
  ['type: "scatter"', /type:\s*"scatter"/, "ScatterChart"],
  ['type: "treemap"', /type:\s*"treemap"/, "TreemapChart"],
  ['type: "heatmap"', /type:\s*"heatmap"/, "HeatmapChart"],
  ['type: "pie"', /type:\s*"pie"/, "PieChart"],
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

const registered = (() => {
  const m = ECHART_CLIENT.match(/echarts\.use\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error("EChartClient.tsx: no echarts.use([...]) block found");
  return new Set(m[1].split(",").map((s) => s.trim()).filter(Boolean));
})();

// chart wrappers = every .tsx (outside EChart itself) that mounts <EChart>,
// plus lib/chartTheme.ts whose baseOption() every wrapper spreads in
const wrappers = tsxFiles(COMPONENTS_DIR)
  .filter((f) => !f.endsWith("EChart.tsx"))
  .filter((f) => /from "(\.\.?\/)+EChart"|from "\.\/EChart"|<EChart\b/.test(readFileSync(f, "utf8")));
const sources = [...wrappers, path.resolve(__dirname, "../lib/chartTheme.ts")];

describe("ECharts lazy wrapper and registry", () => {
  it("keeps the ECharts runtime behind the one shared dynamic import", () => {
    expect(ECHART_WRAPPER).toMatch(/import dynamic from "next\/dynamic"/);
    expect(ECHART_WRAPPER).toMatch(/import\("\.\/EChartClient"\)/);
    expect(ECHART_WRAPPER).toMatch(/ssr:\s*false/);
    expect(ECHART_WRAPPER).not.toMatch(/from "echarts\//);
  });

  it("has no eager ECharts import outside the lazy implementation", () => {
    const eagerImports = tsxFiles(COMPONENTS_DIR)
      .filter((f) => !f.endsWith("EChartClient.tsx"))
      .filter((f) => /import\s+(?!type\b)[^;]+from "echarts\//.test(readFileSync(f, "utf8")));
    expect(eagerImports.map((f) => path.basename(f))).toEqual([]);
  });

  it("finds at least one chart wrapper to audit", () => {
    expect(wrappers.length).toBeGreaterThan(0);
  });

  for (const [label, re, mod] of FEATURES) {
    const users = sources.filter((f) => re.test(readFileSync(f, "utf8")));
    if (users.length === 0) continue;
    it(`${label} (used by ${users.map((f) => path.basename(f)).join(", ")}) -> ${mod} registered`, () => {
      expect(registered.has(mod), `${mod} missing from echarts.use([...]) in EChartClient.tsx`).toBe(true);
    });
  }
});
