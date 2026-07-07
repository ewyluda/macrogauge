import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "macrogauge",
  description: "Daily US inflation & macro analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
