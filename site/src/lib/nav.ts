// Single source of truth for the header nav. Top-level entries are either a
// direct link or a dropdown group; groups hold labelled sections so related
// pages read as one unit (mirrors the footer columns).
export type NavItem = { href: string; label: string; emoji: string };
export type NavSection = { title?: string; items: NavItem[] };
export type NavGroup = { kind: "group"; label: string; sections: NavSection[] };
export type NavEntry = { kind: "link"; href: string; label: string } | NavGroup;

/** One tagline, used by both the <meta> description and the footer. */
export const SITE_DESCRIPTION =
  "An independent daily gauge that re-prices the CPI basket from live market data — published with full receipts, graded against every official print.";

export const NAV: NavEntry[] = [
  { kind: "link", href: "/", label: "Home" },
  {
    kind: "group",
    label: "Inflation",
    sections: [
      {
        title: "The gauge",
        items: [
          { href: "/supercore", label: "Supercore", emoji: "📈" },
          { href: "/cost-of-living", label: "Cost of Living", emoji: "🔑" },
          { href: "/gap", label: "Gauge Gap", emoji: "📐" },
          { href: "/vs-bls", label: "vs BLS", emoji: "⚖️" },
        ],
      },
      {
        title: "Your inflation",
        items: [
          { href: "/my-inflation", label: "My Inflation", emoji: "🧮" },
          { href: "/grocery", label: "Grocery Prices", emoji: "🛒" },
          { href: "/calculator", label: "Since-Date Calculator", emoji: "📆" },
          { href: "/real-wages", label: "Real Wages", emoji: "💵" },
        ],
      },
    ],
  },
  {
    kind: "group",
    label: "Forecasts",
    sections: [
      {
        items: [
          { href: "/cpi-preview", label: "CPI Preview", emoji: "📅" },
          { href: "/next-print", label: "Next Print", emoji: "⏱️" },
          { href: "/outlook", label: "12-Month Outlook", emoji: "🔮" },
          { href: "/scoreboard", label: "Scoreboard", emoji: "🏆" },
          { href: "/matrix", label: "Nowcast Matrix", emoji: "🔢" },
          { href: "/releases", label: "Release Log", emoji: "🧾" },
        ],
      },
    ],
  },
  {
    kind: "group",
    label: "Economy",
    sections: [
      {
        items: [
          { href: "/heatcheck", label: "Heat Check", emoji: "🌡️" },
          { href: "/stress", label: "Consumer Stress", emoji: "🩺" },
          { href: "/recession", label: "Recession Risk", emoji: "📉" },
        ],
      },
    ],
  },
  { kind: "link", href: "/datacenter", label: "Data Centers" },
  {
    kind: "group",
    label: "Data",
    sections: [
      {
        items: [
          { href: "/status", label: "System Status", emoji: "📡" },
          { href: "/methodology", label: "Methodology", emoji: "📖" },
        ],
      },
    ],
  },
];

/** Every href inside a dropdown group — used for the trigger's active-state. */
export function groupHrefs(group: NavGroup): string[] {
  return group.sections.flatMap((s) => s.items.map((i) => i.href));
}
