import type { MetadataRoute } from "next";
import pulse from "../../public/data/pulse.json";
import { NAV } from "@/lib/nav";
import { SITE_URL } from "@/lib/site";
import { COMPONENTS, componentHref } from "@/lib/components";

export const dynamic = "force-static";

/** One entry per nav route — nav.ts is the single source of truth for
 *  routes, so a page cannot ship unlisted — plus the dynamic
 *  /components/[code] pages (one per basket component; not in the nav).
 *  lastModified = the publish stamp. */
export default function sitemap(): MetadataRoute.Sitemap {
  const hrefs = [
    ...NAV.flatMap((e) =>
      e.kind === "link" ? [e.href] : e.sections.flatMap((s) => s.items.map((i) => i.href)),
    ),
    ...COMPONENTS.map((c) => componentHref(c.code)),
  ];
  const lastModified = new Date(pulse.published_at);
  return hrefs.map((href) => ({
    url: `${SITE_URL}${href}`,
    lastModified,
    changeFrequency: "daily",
    priority: href === "/" ? 1 : 0.7,
  }));
}
