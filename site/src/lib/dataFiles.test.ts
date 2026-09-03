import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_FILES } from "./dataFiles";

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
