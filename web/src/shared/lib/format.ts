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
export const fmtMM = (inches: number) => `${Math.round(inches * 25.4)} mm`;

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
