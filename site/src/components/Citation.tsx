"use client";
import { useEffect, useRef, useState } from "react";
import { cite } from "@/lib/citation";

/** The citable reference string for a headline number, with a copy button.
 *  `path` defaults to the current route; with `live`, the current query
 *  string (URL state) is appended after mount so a shared calculator
 *  setting cites itself. */
export function Citation({
  series,
  asOf,
  value,
  rebase,
  path,
  live = false,
}: {
  series: string;
  asOf: string;
  value: string;
  rebase?: string | null;
  path: string;
  live?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!live) return;
    const read = () => setQuery(window.location.search);
    read();
    // useUrlState writes via replaceState (no popstate); poll cheaply on focus/click
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [live]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const text = cite({ series, asOf, value, rebase, path: `${path}${query}` });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this citation", text);
    }
  };
  return (
    <div className="citation">
      <span className="citation-label">Cite</span>
      <code className="citation-text">{text}</code>
      <button type="button" className="tool-btn" onClick={copy}>
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}
