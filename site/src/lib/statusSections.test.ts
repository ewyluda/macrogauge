import { describe, expect, it } from "vitest";
import qa from "../../public/data/qa.json";
import sourcesStatus from "../../public/data/sources_status.json";
import methodology from "../../public/data/methodology.json";
import {
  CHECK_SECTION, CHECK_SECTIONS, CURATED_INPUTS, daysBetween, groupBy, NAV_SECTIONS, SOURCE_SECTION,
  SOURCE_SECTIONS, sourceFreshness,
} from "./statusSections";

describe("statusSections", () => {
  it("orders sections from the nav, AI Infra first", () => {
    expect(NAV_SECTIONS[0]).toBe("AI Infra");
    expect(NAV_SECTIONS).not.toContain("About");
    expect(CHECK_SECTIONS.at(-1)).toBe("Pipeline");
  });
  it("gives every published check and source an explicit section", () => {
    for (const c of qa.checks) expect(CHECK_SECTIONS, c.name).toContain(CHECK_SECTION[c.name]);
    for (const s of sourcesStatus.sources) expect(SOURCE_SECTIONS, s.name).toContain(SOURCE_SECTION[s.name]);
    for (const r of methodology.inventory) expect(SOURCE_SECTIONS, r.source).toContain(SOURCE_SECTION[r.source]);
  });
  it("groups in section order and drops empty sections", () => {
    const g = groupBy(["b", "a", "c"], (x) => (x === "c" ? "Z" : "Y"), ["Z", "X", "Y"]);
    expect(g).toEqual([{ section: "Z", items: ["c"] }, { section: "Y", items: ["b", "a"] }]);
  });
  it("splits a source's series into fresh, stale and expected-absent", () => {
    expect(sourceFreshness([
      { source: "A", fresh: true }, { source: "A", fresh: false }, { source: "A", fresh: false, absence: "suppressed" },
    ])).toEqual({ A: { fresh: 1, stale: 1, absent: 1 } });
  });
  it("dates every curated input", () => {
    for (const c of CURATED_INPUTS) expect(c.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(daysBetween("2026-10-02", "2026-10-08T12:00:00Z")).toBe(6);
  });
});
