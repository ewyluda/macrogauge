"use client";
import { useEffect, useRef, useState } from "react";

/** Copies the current address (which carries every useUrlState control) to
 *  the clipboard. Falls back to selecting nothing but showing the URL when
 *  the Clipboard API is unavailable (insecure context, old browser). */
export function CopyLink({ label = "Copy link" }: { label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
      window.prompt("Copy this link", url);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button type="button" className="tool-btn copy-link" onClick={copy} aria-live="polite">
      {state === "copied" ? "✓ Copied" : state === "failed" ? "Copy failed" : `🔗 ${label}`}
    </button>
  );
}
