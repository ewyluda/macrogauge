import type { Metadata } from "next";
import "./globals.css";
import "./research.css";
import { PageShell } from "@/components/PageShell";
import { SITE_DESCRIPTION } from "@/lib/nav";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // "./" resolves against each route's own pathname, so every page gets a
  // self-canonical on the indexable production origin (query-string variants
  // like ?rate= / ?cm= collapse onto it).
  alternates: { canonical: "./", types: { "application/rss+xml": `${SITE_URL}/feed.xml` } },
  openGraph: { siteName: "MacroGauge", type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image" },
  title: {
    default: "macrogauge — daily US inflation & macro",
    template: "%s — macrogauge",
  },
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="research-site">
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}
