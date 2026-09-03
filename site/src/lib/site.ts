/** Canonical public origin — used for citations, the OG image, the sitemap
 *  and the RSS feed. Overridable at build time so previews cite themselves. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://macrogauge-cloudten.vercel.app").replace(/\/$/, "");
export const SITE_NAME = "MacroGauge";
