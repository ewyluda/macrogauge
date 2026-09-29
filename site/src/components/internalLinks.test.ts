import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/** Review 2026-09-01 B19: an in-site route linked with a raw `<a href="/…">`
 *  forces a full document reload (no client-side navigation or prefetch).
 *  Routes must go through next/link; a raw anchor is only right for a static
 *  FILE the export serves verbatim (feed.xml, /data/*.json, /schemas/*). */

const SRC = path.resolve(__dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

const RAW = /<a\s+(?:[^>]*?\s)?href=(?:"(\/[^"]*)"|\{`(\/[^`]*)`\})/g;
const isStaticFile = (href: string) => {
  const p = href.split(/[?#]/)[0];
  return href.startsWith("//") || /\.[a-z0-9]+$/i.test(p) || /^\/(data|schemas)\//.test(p);
};

describe("internal links", () => {
  it("never link an in-site route with a raw <a href>", () => {
    const offenders: string[] = [];
    for (const f of tsxFiles(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(RAW)) {
        const href = m[1] ?? m[2];
        if (!isStaticFile(href)) offenders.push(`${path.relative(SRC, f)}: ${href}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the audit regex does see a raw route anchor", () => {
    const sample = '<a href="/status">x</a> <a href="/feed.xml">rss</a>';
    const hits = [...sample.matchAll(RAW)].map((m) => m[1]).filter((h) => !isStaticFile(h));
    expect(hits).toEqual(["/status"]);
  });
});
