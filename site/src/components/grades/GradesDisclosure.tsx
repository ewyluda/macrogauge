"use client";
import { useEffect, useState, type ReactNode } from "react";

/** The closed-by-default "full grading record" on /escalation. Opens itself
 *  when a link points into it — its own anchor, or the scatter's URL state
 *  (?leg / ?sb / ?sh) carried over from an old /dc-scoreboard link — so a
 *  deep link never lands on a collapsed box. */
export function GradesDisclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (window.location.hash === "#grades-record" || ["leg", "sb", "sh"].some((k) => q.has(k))) setOpen(true);
  }, []);
  return (
    <details className="grades-record" id="grades-record" open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{summary}</summary>
      <div className="grades-record-body">{children}</div>
    </details>
  );
}
