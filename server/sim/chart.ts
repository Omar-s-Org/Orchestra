// Tiny SVG bar chart: the "generated artifact" a simulated agent attaches to its task.
export type Chart = { title: string; unit?: string; bars: { label: string; value: number }[] };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (v: number, unit = "") => `${Number.isInteger(v) ? v : v.toFixed(2)}${unit}`;

export function chartSvg(c: Chart) {
  const W = 480, H = 260, side = 32, top = 72, base = 212, gap = 20;
  const n = Math.max(c.bars.length, 1);
  const max = Math.max(...c.bars.map(b => b.value), 1e-9);
  const bw = (W - side * 2 - gap * (n - 1)) / n;
  const best = c.bars.reduce((i, b, j) => (b.value > c.bars[i].value ? j : i), 0);
  const bars = c.bars.map((b, i) => {
    const h = Math.max(2, ((base - top) * b.value) / max), x = side + i * (bw + gap), cx = x + bw / 2;
    return `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="4" fill="${i === best ? "#22c55e" : "#64748b"}"/>`
      + `<text x="${cx}" y="${base - h - 8}" fill="#e2e8f0" font-family="Arial" font-size="13" text-anchor="middle">${esc(fmt(b.value, c.unit))}</text>`
      + `<text x="${cx}" y="${base + 20}" fill="#cbd5e1" font-family="Arial" font-size="12" text-anchor="middle">${esc(b.label)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#0f172a"/>`
    + `<text x="24" y="38" fill="#e2e8f0" font-family="Inter,Arial" font-size="18">${esc(c.title)}</text>${bars}</svg>`;
}
