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

/**
 * A #rrggbb colour as hue (0-359), saturation and lightness (0-100), whole numbers - what the palette
 * editor's HSL fields show and step through. Null for anything that isn't #rrggbb.
 */
export function hexToHsl(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360) % 360, Math.round(s * 100), Math.round(l * 100)];
}

/** Hue (degrees), saturation and lightness (0-100) as #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
