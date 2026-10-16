import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

// Next's built-in 404 carries its own inline style that turns the body black
// under a dark OS scheme; this one renders inside the site shell instead.
const WAYS_BACK = [
  { href: "/", eyebrow: "Home", title: "Today's readings", description: "AI infrastructure cost indexes beside the daily CPI gauge." },
  { href: "/datacenter", eyebrow: "AI infrastructure", title: "Data Centers", description: "Build, hardware and operating cost indexes, extended daily." },
  { href: "/data", eyebrow: "Open data", title: "Open Data", description: "Every published JSON file, with its schema and as-of date." },
];

export default function NotFound() {
  return (
    <div>
      <header className="research-intro">
        <div className="research-eyebrow">404 · Page not found</div>
        <h1>There is no page at this address.</h1>
        <p>The link may be old or mistyped. These three lead back into the site.</p>
      </header>
      <nav className="project-toolkit" aria-label="Ways back">
        <div className="project-toolkit-grid">
          {WAYS_BACK.map((w) => (
            <Link key={w.href} href={w.href} className="project-tool-card">
              <span className="project-tool-eyebrow">{w.eyebrow}</span>
              <strong>{w.title}</strong>
              <span>{w.description}</span>
              <b aria-hidden>Go →</b>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
