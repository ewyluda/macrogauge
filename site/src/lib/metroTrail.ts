/** Red when rent growth sped up over the trail, green when it cooled. The
 *  old default coloured by the SIGN of the latest YoY, so a metro whose rent
 *  growth fell from 6% to 1% still drew red: every rising-rent metro did. */
export function accelerationStroke(tail: (number | null)[]): string {
  const xs = tail.filter((v): v is number => v != null);
  if (xs.length < 2) return "var(--muted)";
  const d = xs[xs.length - 1] - xs[0];
  return d > 0.25 ? "var(--accent-red)" : d < -0.25 ? "var(--accent-emerald)" : "var(--muted)";
}
