import { describe, expect, it } from "vitest";
import { chartAriaLabel } from "./chartAria";

describe("chartAriaLabel (B15 chart text alternative)", () => {
  it("names each series with its latest non-null [x, y] point", () => {
    const label = chartAriaLabel(
      {
        series: [
          { name: "Macrogauge", type: "line", data: [["2026-09-25", 3.1], ["2026-09-26", 3.164]] },
          { name: "Official CPI", type: "line", data: [["2026-07", 2.9], ["2026-08", 3.36]] },
        ],
      },
      "Macrogauge vs official CPI",
    );
    expect(label).toBe(
      "Macrogauge vs official CPI — latest: Macrogauge 3.16 at 2026-09-26; Official CPI 3.36 at 2026-08",
    );
  });

  it("reads category-axis data and skips trailing nulls", () => {
    const label = chartAriaLabel({
      xAxis: { type: "category", data: ["Jan", "Feb", "Mar"] },
      series: [{ name: "claims", type: "bar", data: [210000, 225500, null] }],
    });
    expect(label).toBe("Bar chart — latest: claims 225,500 at Feb");
  });

  it("uses a horizontal chart's category y axis and {value} points", () => {
    const label = chartAriaLabel({
      yAxis: { type: "category", data: ["shelter", "food"] },
      series: [{ name: "pp", type: "bar", data: [{ value: 1.2 }, { value: -0.05 }] }],
    });
    expect(label).toBe("Bar chart — latest: pp -0.05 at food");
  });

  it("skips data-less carrier series and says so when nothing plots", () => {
    expect(chartAriaLabel({ series: [{ type: "line", data: [], markArea: {} }] }, "Empty")).toBe("Empty (no data)");
    const label = chartAriaLabel({
      series: [{ type: "line", data: [] }, { type: "line", data: [["2026-01", 1]] }],
    });
    expect(label).toBe("Line chart — latest: series 2 1.00 at 2026-01");
  });

  it("counts treemap leaves instead of a latest value", () => {
    const label = chartAriaLabel({
      series: [{ type: "treemap", data: [{ name: "a", children: [{ name: "a1" }, { name: "a2" }] }, { name: "b" }] }],
    });
    expect(label).toBe("Treemap chart — latest: treemap: 3 items");
  });

  it("caps the list at eight series", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, type: "line", data: [[`x${i}`, i]] }));
    const label = chartAriaLabel({ series });
    expect(label).toContain("s7 7.00 at x7; and 2 more series");
    expect(label).not.toContain("s8 ");
  });
});
