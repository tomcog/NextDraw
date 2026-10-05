// Perceived lightness (CIE L*, 0 = black, 100 = white) of any CSS color, or null if it can't be read.
export function lightness(color: string | null): number | null {
  if (!color) return null;
  const hex = toHex(color);
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; // relative luminance
  return y <= 216 / 24389 ? y * (24389 / 27) : 116 * Math.cbrt(y) - 16;
}

let canvas: CanvasRenderingContext2D | null = null;

// Any CSS color (named, #rgb, rgb()) as #rrggbb, using the browser's own parser.
function toHex(color: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return null;
  canvas.fillStyle = "#010203"; // a sentinel: an unreadable color leaves it unchanged
  canvas.fillStyle = color;
  const out = String(canvas.fillStyle);
  return /^#[0-9a-f]{6}$/i.test(out) && (out !== "#010203" || color.toLowerCase() === "#010203") ? out : null;
}

// How a pen color lands on paper: its ink at the tool's density over the paper's own color. The ink
// multiplies with the paper, the way translucent ink does, and what shows through is the rest.
export function onPaper(color: string, density: number, paper = "#ffffff"): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ir, ig, ib] = channels(color);
  const [pr, pg, pb] = channels(paper);
  const a = Math.min(1, Math.max(0, density));
  const mix = (ink: number, sheet: number) => Math.round((ink * sheet / 255) * a + sheet * (1 - a));
  return `#${[mix(ir, pr), mix(ig, pg), mix(ib, pb)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
