import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_FILES, DATA_SECTIONS, newestAsOf } from "./dataFiles";
import { NAV } from "./nav";

describe("DATA_FILES", () => {
  it("matches public/data exactly", () => {
    const onDisk = readdirSync(path.resolve(__dirname, "../../public/data"))
      .filter((f) => f.endsWith(".json"))
      .sort();
    const listed = DATA_FILES.map((d) => d.file).sort();
    expect(listed).toEqual(onDisk);
  });
  it("has no duplicate or empty descriptions", () => {
    const files = new Set(DATA_FILES.map((d) => d.file));
    expect(files.size).toBe(DATA_FILES.length);
    for (const d of DATA_FILES) expect(d.description.length).toBeGreaterThan(10);
  });
});

describe("DATA_FILES sections", () => {
  it("puts every file in a known section, AI Infra first, in nav order", () => {
    for (const d of DATA_FILES) expect(DATA_SECTIONS, d.file).toContain(d.section);
    const navGroups = NAV.filter((e) => e.kind === "group").map((g) => g.label).filter((l) => l !== "About");
    expect(DATA_SECTIONS[0]).toBe("AI Infra");
    expect(DATA_SECTIONS.slice(0, navGroups.length).sort()).toEqual([...navGroups].sort());
  });
});

describe("newestAsOf", () => {
  it("takes the newest data date at any depth, never a curated review date", () => {
    expect(newestAsOf({ as_of_curated: "2026-12-01", a: { as_of: "2026-09-01" },
      rows: [{ last_obs: "2026-10-02" }, { asof: "2026-10-01T12:00:00Z" }] })).toBe("2026-10-02");
    expect(newestAsOf({ published_at: "2026-10-08T12:00:00Z", note: "x" })).toBeNull();
    expect(newestAsOf({ as_of: null, x: [{ as_of: "not a date" }] })).toBeNull();
  });
});
