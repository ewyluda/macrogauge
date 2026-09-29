import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { artifact } from "./artifact";
import longlead from "../../public/data/longlead.json";

/** B8: every schema gets a generated type, keyed by schema name, so the
 *  `artifact()` seam can type any published artifact by its contract. */
const SCHEMAS = path.resolve(__dirname, "../../../schemas");
const GENERATED = path.resolve(__dirname, "generated");

describe("schema-generated artifact types", () => {
  const names = readdirSync(SCHEMAS)
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => f.replace(/\.schema\.json$/, ""));

  it("generates one module per schema plus an ArtifactTypes key for each", () => {
    const index = readFileSync(path.join(GENERATED, "index.ts"), "utf8");
    const files = readdirSync(GENERATED);
    expect(names.length).toBeGreaterThan(30);
    for (const n of names) {
      expect(files).toContain(`${n}.ts`);
      expect(index).toMatch(new RegExp(`^  ${n}: \\w+Artifact;$`, "m"));
    }
  });

  it("artifact() is a zero-cost identity at runtime", () => {
    expect(artifact("longlead", longlead)).toBe(longlead);
  });
});
