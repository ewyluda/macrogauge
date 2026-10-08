/** /macro-cycle: the heat check, consumer stress and the recession rules on
 *  one page (heatcheck + stress + recession folded 2026-10-08). */

export type RecessionSignal = {
  name: string; code: string; rule: string; value: number | null; as_of?: string | null;
  triggered: boolean | null; op?: ">=" | ">" | "<"; threshold?: number;
};

/** How far a reading may move before its rule triggers, by rule. A bar is
 *  full at this much room: a stated design scale per rule (units differ),
 *  not a probability. */
export const ROOM_SCALE: Record<string, { scale: number; unit: string; digits: number }> = {
  SAHMREALTIME: { scale: 0.5, unit: "pp", digits: 2 },
  T10Y3M: { scale: 1.5, unit: "pp", digits: 2 },
  NFCI: { scale: 0.75, unit: "", digits: 2 },
  ICSA: { scale: 15, unit: " pts", digits: 1 },
  CFNAIMA3: { scale: 1.0, unit: "", digits: 2 },
  RECPROUSM156N: { scale: 20, unit: "pp", digits: 1 },
};

/** Room left before a rule triggers (positive) or how far past it (negative),
 *  and that room as a 0..1 share of the rule's design scale. Null without a
 *  reading or a published numeric test. */
export function distanceToTrigger(s: RecessionSignal): { room: number; share: number; label: string } | null {
  if (s.value == null || s.threshold == null || !s.op) return null;
  const room = s.op === "<" ? s.value - s.threshold : s.threshold - s.value;
  const cfg = ROOM_SCALE[s.code] ?? { scale: Math.abs(s.threshold) || 1, unit: "", digits: 2 };
  const share = Math.max(0, Math.min(1, room / cfg.scale));
  const amount = `${Math.abs(room).toFixed(cfg.digits)}${cfg.unit}`;
  return { room, share, label: s.triggered ? `triggered, ${amount} past` : `${amount} to trigger` };
}

const heatWord = (score: number) =>
  score > 25 ? "running hot" : score > 5 ? "warming" : score < -25 ? "cooling hard" : score < -5 ? "cooling" : "near neutral";
const stressWord = (score: number) => (score >= 80 ? "severe" : score >= 50 ? "elevated" : "calm");

/** "The economy is cooling (heat −9), consumer stress is elevated (61 of
 *  100), and none of 6 recession rules has triggered." Clauses drop when a
 *  composite is missing; null with none. */
export function macroCycleSentence(heat: number | null, stress: number | null,
                                   triggered: number, available: number): string | null {
  const parts: string[] = [];
  if (heat != null) parts.push(`the economy is ${heatWord(heat)} (heat ${heat > 0 ? "+" : heat < 0 ? "−" : ""}${Math.abs(Math.round(heat))})`);
  if (stress != null) parts.push(`consumer stress is ${stressWord(stress)} (${Math.round(stress)} of 100)`);
  if (available > 0) parts.push(triggered === 0 ? `none of ${available} recession rules has triggered`
    : `${triggered} of ${available} recession rules ${triggered === 1 ? "has" : "have"} triggered`);
  if (!parts.length) return null;
  const s = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}
