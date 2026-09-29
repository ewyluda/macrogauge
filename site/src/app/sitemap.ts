import type { MetadataRoute } from "next";
import pulse from "../../public/data/pulse.json";
import { NAV } from "@/lib/nav";
import { SITE_URL } from "@/lib/site";
import { COMPONENTS, componentHref } from "@/lib/components";
import grocery from "../../public/data/grocery_basket.json";
import geo from "../../public/data/geo.json";
import metros from "../../public/data/metros.json";
import { grocerySlug, metroSlug, stateSlug } from "@/lib/longtail";

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
    "/escalation/clause",
    // programmatic long-tail pages (one per published item/state/metro)
    ...grocery.items.map((i) => `/grocery/${grocerySlug(i.name)}`),
    ...geo.states.map((s) => `/states/${stateSlug(s.state)}`),
    ...metros.metros.map((m) => `/metros/${metroSlug(m.name)}`),
  ];
  const lastModified = new Date(pulse.published_at);
  return hrefs.map((href) => ({
    url: `${SITE_URL}${href}`,
    lastModified,
    changeFrequency: "daily",
    priority: href === "/" ? 1 : 0.7,
  }));
}
