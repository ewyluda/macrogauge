import { heatColor } from "./heat";

export type QuiltRow = { label: string; values: (number | null)[] };

/** Render the quilt to a fixed 1920×1080 canvas and trigger a download.
 *  Colors via heatColor — the same function the DOM grid uses, so the
 *  export cannot drift from the display. */
export function exportQuiltPng(
  months: string[],
  componentRows: QuiltRow[],
  headlineRows: QuiltRow[],
  asOf: string,
  sourceLabel = "OURS" // which grid fills the component cells: OURS or BLS
): void {
  const W = 1920;
  const H = 1080;
  const left = 230;
  const top = 90;
  const bottom = 60;
  const gap = 14; // visual gap between component grid and headline rows
  const nRows = componentRows.length + headlineRows.length;
  const cellW = (W - left - 20) / months.length;
  const cellH = (H - top - bottom - gap) / nRows;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0B0F14";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#E6EDF3";
  ctx.font = "bold 28px ui-sans-serif, system-ui";
  ctx.fillText("MACROGAUGE — INFLATION QUILT", 24, 44);
  ctx.fillStyle = "#8B98A5";
  ctx.font = "16px ui-sans-serif, system-ui";
  ctx.fillText(
    `${sourceLabel} component YoY %, every month · as of ${asOf}`,
    24,
    70
  );

  const drawRow = (row: QuiltRow, y: number) => {
    ctx.fillStyle = "#8B98A5";
    ctx.font = "13px ui-sans-serif, system-ui";
    ctx.textAlign = "right";
    ctx.fillText(row.label, left - 8, y + cellH / 2 + 4);
    ctx.textAlign = "center";
    row.values.forEach((v, i) => {
      const x = left + i * cellW;
      ctx.fillStyle = heatColor(v);
      ctx.fillRect(x, y, cellW - 1, cellH - 1);
      if (v !== null && cellW >= 30) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "11px ui-sans-serif, system-ui";
        ctx.fillText(v.toFixed(1), x + cellW / 2, y + cellH / 2 + 4);
      }
    });
    ctx.textAlign = "left";
  };

  componentRows.forEach((r, ri) => drawRow(r, top + ri * cellH));
  const hTop = top + componentRows.length * cellH + gap;
  headlineRows.forEach((r, ri) => drawRow(r, hTop + ri * cellH));

  // month labels: at most ~24, evenly thinned
  const step = Math.max(1, Math.ceil(months.length / 24));
  ctx.fillStyle = "#8B98A5";
  ctx.font = "12px ui-sans-serif, system-ui";
  months.forEach((m, i) => {
    if (i % step !== 0) return;
    ctx.save();
    ctx.translate(left + i * cellW + cellW / 2, H - bottom + 34);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(m, 0, 0);
    ctx.restore();
  });

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `macrogauge-quilt-${asOf}.png`;
  a.click();
}
