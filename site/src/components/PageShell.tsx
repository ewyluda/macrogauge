import Link from "next/link";
import qa from "../../public/data/qa.json";
import { NavBar } from "./NavBar";
import { SiteFooter } from "./SiteFooter";
import { StatusPill } from "./StatusPill";

export function PageShell({ children }: { children: React.ReactNode }) {
  const failedChecks = qa.checks.filter((check) => !check.pass);
  const criticalFailures = failedChecks.filter((check) => check.critical).length;
  const advisoryFailures = failedChecks.length - criticalFailures;
  const selfTestTone = criticalFailures > 0
    ? "critical"
    : advisoryFailures > 0
      ? "advisory"
      : "ok";
  const selfTestLabel = criticalFailures > 0
    ? `${criticalFailures} critical`
    : advisoryFailures > 0
      ? `${advisoryFailures} advisor${advisoryFailures === 1 ? "y" : "ies"}`
      : `Self-test ${qa.passed}/${qa.total}`;

  return (
    <main className="page-shell">
      <header className="site-header">
        <div className="header-primary">
          <Link href="/" style={{ textDecoration: "none", color: "var(--text)" }}>
            <span className="wordmark">
              MACROGAUGE
            </span>
          </Link>
          <NavBar />
        </div>
        <div className="header-status">
          <Link href="/status" style={{ textDecoration: "none" }}>
            <StatusPill tone={selfTestTone} label={selfTestLabel} />
          </Link>
        </div>
      </header>
      <div className="research-page">{children}</div>
      <SiteFooter />
    </main>
  );
}
