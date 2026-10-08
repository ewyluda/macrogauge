// The /datacenter hub and /power page headlines, written from the published
// datacenter.json so the words and the numbers beside them can never disagree.
import { moveWords } from "./homeBrief";
import type { CapacityMarket, PowerData, PowerHub } from "@/components/PowerPanel";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthYear = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

type Yoy = { label: string; yoy: number | null };

/** "Hardware costs are up 32.2% on the year; build up 8.5%, ops up 5.6%" — the
 *  biggest mover leads. Null when no index has a reading. */
export function dcHeadline(indexes: Yoy[]): string | null {
  const live = indexes.filter((i): i is { label: string; yoy: number } => i.yoy != null)
    .sort((a, b) => Math.abs(b.yoy) - Math.abs(a.yoy));
  if (!live.length) return null;
  const [lead, ...rest] = live;
  const tail = rest.map((r) => `${r.label.toLowerCase()} ${moveWords(r.yoy)}`).join(", ");
  return `${lead.label} costs are ${moveWords(lead.yoy)} on the year${tail ? `; ${tail}` : ""}`;
}

export type Surge = { from: string; fromValue: number; to: string; toValue: number; pct: number; label: string };

/**
 * The move from a series' low inside the trailing window to its latest value,
 * when it is big enough to annotate (|move| >= minPct). Data-derived, so the
 * note stays true as the series moves on — and disappears if the surge does.
 */
export function surgeFromLow(label: string, dates: string[], index: (number | null)[],
                             windowDays = 730, minPct = 15): Surge | null {
  let last = -1;
  for (let i = index.length - 1; i >= 0; i--) if (index[i] != null) { last = i; break; }
  if (last < 0) return null;
  const end = dates[last];
  const start = new Date(Date.parse(end) - windowDays * 864e5).toISOString().slice(0, 10);
  let lo = -1;
  for (let i = 0; i <= last; i++) {
    const v = index[i];
    if (v == null || dates[i] < start) continue;
    if (lo < 0 || v < index[lo]!) lo = i;
  }
  if (lo < 0 || lo === last) return null;
  const pct = (index[last]! / index[lo]! - 1) * 100;
  if (pct < minPct) return null;
  return { from: dates[lo], fromValue: index[lo]!, to: end, toValue: index[last]!, pct,
           label: `${label} +${Math.round(pct)}% since ${monthYear(dates[lo])}` };
}

/** Capacity markets by operator. `capacity_markets` is optional (older
 *  artifacts carry only the required PJM `capacity_auction`), so an absent or
 *  empty list falls back to PJM's auction history in the same shape. The one
 *  normalization behind both the detailed chart and the hub summary. */
export function capacityMarkets(power: PowerData): CapacityMarket[] {
  if (power.capacity_markets?.length) return power.capacity_markets;
  const a = power.capacity_auction;
  return a.rows.length ? [{
    iso: "PJM", name: "Base Residual Auction", product: "RTO clearing price, $/MW-day",
    status: "auction", note: "", source: "PJM", source_url: "https://www.pjm.com/markets-and-operations/rpm",
    asof: a.asof,
    rows: a.rows.map((r) => ({ period: r.delivery_year, price_mw_day: r.price_mw_day })),
  }] : [];
}

export type PowerSummary = {
  hub: PowerHub | null;               // the hottest hub by 30-day YoY
  capacity: { iso: string; period: string; price: number; first: string; firstPrice: number } | null;
  tariffs: number;
  headline: string | null;
};

/** "up 62%" for a big move, "up 3.4%" for a small one: an H1 drops the
 *  decimal only where it carries no information. */
function headlineMove(pct: number): string {
  return Math.abs(pct) >= 10 ? `${pct > 0 ? "up" : "down"} ${Math.round(Math.abs(pct))}%` : moveWords(pct);
}

/** The three readings the hub shows for the power bill, and the /power H1. */
export function powerSummary(power: PowerData | null | undefined): PowerSummary {
  if (!power) return { hub: null, capacity: null, tariffs: 0, headline: null };
  const hub = power.hubs.filter((h) => h.avg30_yoy_pct != null)
    .sort((a, b) => b.avg30_yoy_pct! - a.avg30_yoy_pct!)[0] ?? null;
  const markets = capacityMarkets(power);
  const pjm = markets.find((m) => m.iso === "PJM" && m.rows.length) ??
    markets.find((m) => m.status === "auction" && m.rows.length);
  const capacity = pjm ? {
    iso: pjm.iso, period: pjm.rows[pjm.rows.length - 1].period, price: pjm.rows[pjm.rows.length - 1].price_mw_day,
    first: pjm.rows[0].period, firstPrice: pjm.rows[0].price_mw_day,
  } : null;
  const tariffs = power.tariffs?.length ?? 0;
  const parts: string[] = [];
  // one short claim per clause: the KPI cards beneath date each reading (hubs
  // refresh on different cadences, ICE about every two weeks, so the featured
  // window is the hub's own and is stated there, never "this month")
  if (hub) parts.push(`${hub.label} power is ${headlineMove(hub.avg30_yoy_pct!)} on the year`);
  if (capacity && capacity.firstPrice > 0) {
    const x = capacity.price / capacity.firstPrice;
    // the ISO is implied when the featured hub sits in the same grid
    const iso = hub?.grid === capacity.iso ? "" : `${capacity.iso} `;
    if (x >= 2) parts.push(`${iso}capacity costs ${Math.round(x)}× its ${capacity.first} price`);
  }
  return { hub, capacity, tariffs, headline: parts.length ? parts.join("; ") : null };
}
