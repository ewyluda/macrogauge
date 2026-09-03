import { describe, expect, it } from "vitest";
import { cite } from "./citation";
import { SITE_URL } from "./site";

describe("cite", () => {
  it("formats the canonical string with rebase", () => {
    expect(
      cite({ series: "DC Build Index", asOf: "2026-07-21", rebase: "2018-01=100", value: "+6.81% YoY", path: "/datacenter" }),
    ).toBe(`MacroGauge DC Build Index, 2026-07-21, 2018-01=100, +6.81% YoY — ${SITE_URL}/datacenter`);
  });
  it("omits rebase when absent and keeps query state in the path", () => {
    expect(cite({ series: "gauge", asOf: "2026-09-01", value: "3.0% YoY", path: "/calculator?since=2020-01-01" }))
      .toBe(`MacroGauge gauge, 2026-09-01, 3.0% YoY — ${SITE_URL}/calculator?since=2020-01-01`);
  });
});
