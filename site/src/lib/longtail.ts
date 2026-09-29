/** URL slugs for the programmatic long-tail pages (/grocery/[item],
 *  /states/[st], /metros/[m]). Pure — unit-tested; the same functions build
 *  generateStaticParams, the sitemap and the links from the index pages. */
import { cleanName } from "./groceryLabels";

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const grocerySlug = (name: string) => slugify(cleanName(name).title);
export const stateSlug = (code: string) => code.toLowerCase();
export const metroSlug = (name: string) => slugify(name);

/** Throws on a collision — two pages must never share a URL. */
export function uniqueSlugs<T>(rows: T[], slug: (r: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const s = slug(r);
    if (!s) throw new Error("empty slug");
    if (out.has(s)) throw new Error(`slug collision: ${s}`);
    out.set(s, r);
  }
  return out;
}
