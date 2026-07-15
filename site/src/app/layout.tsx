import type { Metadata } from "next";
import "./globals.css";
import { PageShell } from "@/components/PageShell";
import { SITE_DESCRIPTION } from "@/lib/nav";

export const metadata: Metadata = {
  title: {
    default: "macrogauge — daily US inflation & macro",
    template: "%s — macrogauge",
  },
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}
