"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV, groupHrefs } from "@/lib/nav";

export function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // route change or Escape closes any open menu
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // tap/click anywhere outside the nav dismisses the menu (mouseleave never
  // fires on touch devices, so this is the only close path there)
  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <nav className="site-nav" aria-label="Primary" ref={navRef}>
      {NAV.map((entry) => {
        if (entry.kind === "link") {
          const active = pathname === entry.href;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={active ? "nav-link active" : "nav-link"}
              aria-current={active ? "page" : undefined}
            >
              {entry.label}
            </Link>
          );
        }
        const isOpen = open === entry.label;
        const childActive = groupHrefs(entry).includes(pathname);
        return (
          <div
            key={entry.label}
            className={isOpen ? "nav-group open" : "nav-group"}
            // hover open/close is mouse-only: a touch tap synthesizes
            // mouseenter right before click, which would toggle twice
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setOpen(entry.label);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse")
                setOpen((o) => (o === entry.label ? null : o));
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setOpen((o) => (o === entry.label ? null : o));
            }}
          >
            <button
              type="button"
              className={childActive ? "nav-trigger active" : "nav-trigger"}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : entry.label)}
            >
              {entry.label}
              <span className="nav-caret" aria-hidden>
                {isOpen ? "▴" : "▾"}
              </span>
            </button>
            {/* always in the DOM (CSS-hidden when closed) so every route has
                a server-rendered link for crawlers and no-JS visitors */}
            <div className="nav-menu">
              {entry.sections.map((section, i) => (
                <div className="nav-menu-col" key={section.title ?? i}>
                  {section.title && (
                    <div className="nav-menu-head">{section.title}</div>
                  )}
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={
                        pathname === item.href
                          ? "nav-menu-link active"
                          : "nav-menu-link"
                      }
                      aria-current={pathname === item.href ? "page" : undefined}
                    >
                      <span className="nav-emoji" aria-hidden>
                        {item.emoji}
                      </span>
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
