import type { Units } from "./types";

export function trimNum(n: number, digits: number) {
  return n.toFixed(digits).replace(/\.?0+$/, "") || "0";
}

// A length given in mm, in the chosen unit: "12 mm" or "0.47 in".
export function fmtLen(mmValue: number, units: Units, withUnit = true) {
  const text = units === "in" ? trimNum(mmValue / 25.4, 2) : String(Math.round(mmValue));
  return withUnit ? `${text} ${units}` : text;
}

export const fmtIn = (inches: number) => `${inches.toFixed(2).replace(/\.?0+$/, "")} in`;

export function fmtDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function fmtDistance(meters: number) {
  if (meters < 1) return `${Math.round(meters * 100)} cm`;
  return `${meters.toFixed(meters < 10 ? 2 : 1)} m`;
}

// NextDraw prefixes its notes with tags like "Warning (bounds):"; drop the tag.
export const cleanNote = (text: string) => String(text).replace(/^(warning|note|error)\s*\([^)]*\):\s*/i, "");

export const near = (a: number, b: number) => Math.abs(a - b) < 0.6;

/** Names as a sentence would list them: "a", "a and b", "a, b and c". */
export const listOf = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * How far an arrow key moves a number box, everywhere in NextDraw, or null for any other key. The
 * caller stops the browser's own step (`preventDefault`) when it uses this.
 *
 * Scaled to the field's range (Tom, 2026-10-11): about a fiftieth of it, rounded down to a power of
 * ten, so a 0-20 mm smoothing moves 0.1 a press and a 0-4 in margin 0.01, where a whole unit would
 * leap across it. Never more than one unit - a millimetre, a degree, a percent - whatever coarser
 * step the field has (an angle stepping by 15° still moves 1°). A field of whole numbers - its step
 * a whole number, a count or a percent - still moves by one. Ten times as far with Shift. A field
 * with no range moves one unit.
 */
export const arrowStep = (e: { key: string; shiftKey: boolean }, range: { min?: number; max?: number; step?: number } = {}): number | null => {
  const sign = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
  if (!sign) return null;
  const span = (range.max ?? NaN) - (range.min ?? NaN);
  const scaled = span > 0 ? Math.min(1, 10 ** Math.floor(Math.log10(span / 50))) : 1;
  const whole = range.step !== undefined && Number.isInteger(range.step) && range.step >= 1;
  const unit = whole ? 1 : scaled;
  return Number((sign * unit * (e.shiftKey ? 10 : 1)).toPrecision(6));
};
