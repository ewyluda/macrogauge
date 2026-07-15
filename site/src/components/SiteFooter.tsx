import Link from "next/link";
import sourcesStatus from "../../public/data/sources_status.json";
import { NAV, SITE_DESCRIPTION } from "@/lib/nav";

// Columns are derived from the nav config so every route keeps exactly one
// owner for its href/label: top-level links form an Overview column, then one
// column per dropdown group.
const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Overview",
    links: NAV.filter((e) => e.kind === "link").map((e) => [e.href, e.label]),
  },
  ...NAV.filter((e) => e.kind === "group").map((g) => ({
    title: g.label,
    links: g.sections.flatMap((s) =>
      s.items.map((i): [string, string] => [i.href, i.label]),
    ),
  })),
];

export function SiteFooter() {
  const names = sourcesStatus.sources.map((s) => s.name);
  const shown = names.slice(0, 9);
  const rest = names.length - shown.length;
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand">
          <span className="wordmark" style={{ fontSize: 14 }}>
            MACROGAUGE
          </span>
          <p>{SITE_DESCRIPTION}</p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          {COLUMNS.map((col) => (
            <div className="footer-col" key={col.title}>
              <div className="footer-col-head">{col.title}</div>
              {col.links.map(([href, label]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="footer-meta">
        Updated each weekday morning · every forecast graded in public · not
        investment advice. Data: {shown.join(", ")}
        {rest > 0 ? ` and ${rest} more sources` : ""} — collected daily,
        published with as-of dates.
      </div>
    </footer>
  );
}
