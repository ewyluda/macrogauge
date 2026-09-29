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

  // Landmarks (review 2026-09-01 B16): banner, primary nav and contentinfo sit
  // BESIDE <main>, not inside it, so "jump to main" skips the chrome. The skip
  // link is the first focusable element on every page; <main> takes
  // tabIndex -1 so activating it moves focus (not just scroll) into content.
  return (
    <div className="page-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
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
      <main id="main-content" className="research-page" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  );
}
