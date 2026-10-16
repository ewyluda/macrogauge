import type { StatusTone } from "@/components/StatusPill";

export type SourceRow = {
  name: string;
  ok: boolean;
  error: string | null;
  finished_at: string;
  latest_obs: string | null;
};

export type SourcePill = {
  id: string;
  tone: StatusTone;
  /** visible pill text: the status is spelled out ("error"), never colour-only */
  label: string;
  /** the full status sentence — the pill's accessible description, and for a
   *  failed source the visible line under the strip (B14: the error text used
   *  to live only in a mouse-hover `title`) */
  detail: string;
};

/** How a forward-dated feed's newest row reads: a forecast horizon, a
 *  market-implied path or tomorrow's day-ahead price — never "latest data". */
const FORWARD_KIND: Record<string, string> = {
  STEO: "forecast to",
  KALSHI_FED: "market path to",
  ERCOT: "day-ahead",
};

/** A source's newest observation date, labelled when it is dated after the
 *  pull itself (polish review 2026-10-15: STEO 2027-12-01 sat under a green
 *  check as if it were the latest data). */
export function obsLabel(s: Pick<SourceRow, "name" | "latest_obs" | "finished_at">): string {
  if (!s.latest_obs) return "never";
  const pulled = s.finished_at.slice(0, 10);
  if (s.latest_obs <= pulled) return s.latest_obs;
  return `${FORWARD_KIND[s.name] ?? "dated ahead to"} ${s.latest_obs}`;
}

/** Homepage Sources strip rows (review 2026-09-01 B14). Connector errors are
 *  advisory, never critical (the pipeline's connectors_ok check is
 *  critical: False) — see StatusPill. */
export function sourcePills(sources: readonly SourceRow[]): SourcePill[] {
  return sources.map((s) => {
    const id = `source-${s.name.replace(/[^a-z0-9_-]/gi, "-")}`;
    const obs = obsLabel(s);
    const what = s.latest_obs && obs !== s.latest_obs ? obs : `latest observation ${obs}`;
    return s.ok
      ? { id, tone: "ok", label: `${s.name} · ${obs}`, detail: `${s.name} ok · ${what} · last pull ${s.finished_at}` }
      : { id, tone: "advisory", label: `${s.name} · error · ${obs}`, detail: `${s.name} failed: ${s.error ?? "unknown error"} · ${what}` };
  });
}
