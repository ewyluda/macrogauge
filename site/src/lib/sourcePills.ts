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

/** Homepage Sources strip rows (review 2026-09-01 B14). Connector errors are
 *  advisory, never critical (the pipeline's connectors_ok check is
 *  critical: False) — see StatusPill. */
export function sourcePills(sources: readonly SourceRow[]): SourcePill[] {
  return sources.map((s) => {
    const id = `source-${s.name.replace(/[^a-z0-9_-]/gi, "-")}`;
    const obs = s.latest_obs ?? "never";
    return s.ok
      ? { id, tone: "ok", label: `${s.name} · ${obs}`, detail: `${s.name} ok · latest observation ${obs} · last pull ${s.finished_at}` }
      : { id, tone: "advisory", label: `${s.name} · error · ${obs}`, detail: `${s.name} failed: ${s.error ?? "unknown error"} · latest observation ${obs}` };
  });
}
