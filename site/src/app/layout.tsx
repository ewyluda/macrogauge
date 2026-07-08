import type { Metadata } from "next";
import "./globals.css";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "macrogauge",
  description: "Daily US inflation & macro analytics",
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
