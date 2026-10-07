// The homepage's AI-infrastructure takeaway, written from the published DC
// indexes so the sentence and the tiles beside it can never disagree.
import { fmtPp } from "./format";

export type BriefComp = { label: string; contribution_pp: number | null };

/** "up 8.5%" / "down 1.2%" / "flat" — one decimal, sign from the rounded value. */
export function moveWords(pct: number): string {
  const r = Number(pct.toFixed(1));
  if (r === 0) return "flat";
  return `${r > 0 ? "up" : "down"} ${Math.abs(r).toFixed(1)}%`;
}

/** Lower-case a label for mid-sentence use, leaving acronyms ("AC & …") alone. */
export function midSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

/**
 * Two sentences: the build index and its two biggest same-direction drivers,
 * then hardware and ops. Drivers move the headline the way it moved, so a
 * falling component never "leads" a rising index. Null when build is missing.
 */
export function dcTakeaway({
  build,
  ops,
  hardware,
  comps,
}: {
  build: number | null;
  ops: number | null;
  hardware: number | null;
  comps: BriefComp[];
}): string | null {
  if (build == null) return null;
  const sign = Math.sign(Number(build.toFixed(1)));
  const leaders = sign === 0 ? [] : comps
    .filter((c): c is { label: string; contribution_pp: number } =>
      c.contribution_pp != null && Math.sign(Number(c.contribution_pp.toFixed(2))) === sign)
    .sort((a, b) => Math.abs(b.contribution_pp) - Math.abs(a.contribution_pp))
    .slice(0, 2)
    .map((c) => `${midSentence(c.label)} (${fmtPp(c.contribution_pp)})`);
  let first = `Data-center build input costs are ${moveWords(build)} on the year`;
  if (leaders.length) first += `, led by ${leaders.join(" and ")}`;
  first += ".";
  const rest: string[] = [];
  if (hardware != null) rest.push(`IT hardware costs are ${moveWords(hardware)}`);
  if (ops != null) rest.push(`${rest.length ? "operating costs" : "Operating costs are"} ${moveWords(ops)}`);
  return rest.length ? `${first} ${rest.join(" and ")}.` : first;
}
