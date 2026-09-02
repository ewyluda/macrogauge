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
const SRC_DIR = path.resolve(__dirname, "..");
const ECHART_WRAPPER = readFileSync(path.join(COMPONENTS_DIR, "EChart.tsx"), "utf8");
const ECHART_CLIENT = readFileSync(path.join(COMPONENTS_DIR, "EChartClient.tsx"), "utf8");

// option key regex -> the echarts module that must be registered for it
// Every optional echarts/core component and chart type, not just the ones
// used today: a feature absent from this table is exactly the drift the
// test exists to catch (review follow-up 2026-09-02). Series types match
// either quote style.
const seriesType = (name: string) => new RegExp(`type:\\s*["']${name}["']`);
const FEATURES: [string, RegExp, string][] = [
  ["markLine", /\bmarkLine\s*:/, "MarkLineComponent"],
  ["markArea", /\bmarkArea\s*:/, "MarkAreaComponent"],
  ["markPoint", /\bmarkPoint\s*:/, "MarkPointComponent"],
  ["dataZoom", /\bdataZoom\s*:/, "DataZoomComponent"],
  ["visualMap", /\bvisualMap\s*:/, "VisualMapComponent"],
  ["toolbox", /\btoolbox\s*:/, "ToolboxComponent"],
  ["tooltip", /\btooltip\s*:/, "TooltipComponent"],
  ["legend", /\blegend\s*:/, "LegendComponent"],
  ["grid", /\bgrid\s*:/, "GridComponent"],
  ["title", /^\s*title\s*:\s*\{/m, "TitleComponent"],
  ["graphic", /\bgraphic\s*:/, "GraphicComponent"],
  ["dataset", /\bdataset\s*:/, "DatasetComponent"],
  ["timeline", /\btimeline\s*:/, "TimelineComponent"],
  ["polar", /\bpolar\s*:/, "PolarComponent"],
  ["radar", /\bradar\s*:/, "RadarComponent"],
  ["brush", /\bbrush\s*:/, "BrushComponent"],
  ["aria", /\baria\s*:/, "AriaComponent"],
  ["axisPointer (top-level)", /^\s*axisPointer\s*:/m, "AxisPointerComponent"],
  ...["line", "bar", "scatter", "treemap", "heatmap", "pie", "candlestick",
      "boxplot", "gauge", "funnel", "sankey", "graph", "map", "sunburst",
      "radar", "effectScatter", "lines", "pictorialBar", "themeRiver",
      "custom"].map((n): [string, RegExp, string] => [
    `type: "${n}"`, seriesType(n),
    `${n[0].toUpperCase()}${n.slice(1)}Chart`,
  ]),
];

function tsxFiles(dir: string, exts = [".tsx"]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full, exts);
    return exts.some((e) => name.endsWith(e)) && !/\.test\.tsx?$/.test(name)
      ? [full]
      : [];
  });
}

const registered = (() => {
  const m = ECHART_CLIENT.match(/echarts\.use\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error("EChartClient.tsx: no echarts.use([...]) block found");
  return new Set(m[1].split(",").map((s) => s.trim()).filter(Boolean));
})();

// chart wrappers = every .tsx anywhere under src/ (outside EChart itself)
// that mounts <EChart>, plus every src/lib module that mentions ECharts
// (chartTheme's baseOption() is spread into every wrapper; a future option
// builder in lib/ or app/ is audited the same way instead of slipping past a
// components/-only scan). Plain JSON type modules are excluded so an
// artifact field named e.g. `timeline` is not mistaken for an option key.
const wrappers = tsxFiles(SRC_DIR)
  .filter((f) => !f.endsWith("EChart.tsx"))
  .filter((f) => /from "(\.\.?\/)+EChart"|from "\.\/EChart"|from "@\/components\/EChart"|<EChart\b/.test(readFileSync(f, "utf8")));
const libOptionBuilders = tsxFiles(path.join(SRC_DIR, "lib"), [".ts", ".tsx"])
  .filter((f) => /echarts|baseOption/i.test(readFileSync(f, "utf8")));
const sources = [...wrappers, ...libOptionBuilders];

describe("ECharts lazy wrapper and registry", () => {
  it("keeps the ECharts runtime behind the one shared dynamic import", () => {
    expect(ECHART_WRAPPER).toMatch(/import dynamic from "next\/dynamic"/);
    expect(ECHART_WRAPPER).toMatch(/import\("\.\/EChartClient"\)/);
    expect(ECHART_WRAPPER).toMatch(/ssr:\s*false/);
    expect(ECHART_WRAPPER).not.toMatch(/from ["']echarts(\/|["'])/);
  });

  it("has no eager ECharts import outside the lazy implementation", () => {
    // bare "echarts" (the full build) counts too, not only "echarts/…"
    const eagerImports = tsxFiles(SRC_DIR, [".ts", ".tsx"])
      .filter((f) => !f.endsWith("EChartClient.tsx"))
      .filter((f) => /import\s+(?!type\b)[^;]+from ["']echarts(\/[^"']*)?["']/.test(readFileSync(f, "utf8")));
    expect(eagerImports.map((f) => path.relative(SRC_DIR, f))).toEqual([]);
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
