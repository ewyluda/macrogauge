/** Build-time SVG badges (shields-style) for embedding a live reading on
 *  another site: <img src="https://macrogauge.vercel.app/badge/gauge.svg">.
 *  Static export: regenerated on every daily publish. Pure — unit-tested. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const width = (s: string) => Math.round(s.length * 6.6 + 14);

export function badgeSvg(label: string, value: string, color: string): string {
  const lw = width(label), vw = width(value), w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${lw}" height="20" fill="#1F2933"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14" fill="#0B0F14">${esc(value)}</text>
</g></svg>`;
}

export function svgResponse(svg: string): Response {
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
}
