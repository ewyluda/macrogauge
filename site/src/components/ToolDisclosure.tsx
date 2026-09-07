"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure semantics with the dismissal behavior of a toolbar menu. */
export function ToolDisclosure({ label, children, className = "" }: {
  label: string; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open && ref.current.contains(event.target as Node)) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details ref={ref} name="research-tools" className={`research-disclosure ${className}`}>
      <summary className="tool-btn">{label}</summary>
      <div className="research-popover">{children}</div>
    </details>
  );
}
