// A change to the current drawing from an app that doesn't hold it as shapes - Plot: read it, change
// it with the same edits Studio and Image make to the drawing they hold, and send it back as a change
// not saved, as theirs are. The server keeps Plot's own block (carry_plot_block), so where the drawing
// sits, its inks and what's been printed all stay.

import { api, postJSON } from "../api";
import { PAPER_SIZES } from "../constants";
import { loadFont, type StrokeFont } from "./font";
import { parseDrawing } from "./parse";
import { buildSvg } from "./svg";
import type { Page } from "./shapes";
import type { TrimDrawing } from "./trimMarks";
import type { Current } from "./useDrawingFile";

const sizeIdOf = (page: Page) =>
  PAPER_SIZES.find((p) => {
    const w = p.w / 25.4, h = p.h / 25.4;
    return (Math.abs(w - page.w) < 0.01 && Math.abs(h - page.h) < 0.01) || (Math.abs(h - page.w) < 0.01 && Math.abs(w - page.h) < 0.01);
  })?.id ?? "custom";

/** The current drawing as shapes, or null with none open. Throws for one that can't be read whole. */
export async function readCurrent(): Promise<{ current: Current; drawing: ReturnType<typeof parseDrawing> } | null> {
  const current = await api<Current>("/api/current");
  if (current.empty) return null;
  return { current, drawing: parseDrawing(current.svg) };
}

/**
 * The current drawing changed by `edit` and sent back. Refused for a drawing with marks that can't be
 * redrawn from shapes - written back, they'd be lost - and while the plotter is drawing (the server's).
 */
export async function editCurrent(edit: (d: TrimDrawing) => TrimDrawing): Promise<{ edited: string }> {
  const read = await readCurrent();
  if (!read) throw new Error("Open a drawing first.");
  const { current, drawing } = read;
  if (drawing.unsupported) {
    throw new Error(`${drawing.unsupported} ${drawing.unsupported === 1 ? "mark" : "marks"} in ${current.name} can’t be redrawn, and changing the drawing here would drop ${drawing.unsupported === 1 ? "it" : "them"}.`);
  }
  const next = edit({ shapes: drawing.shapes, layers: drawing.layers, page: drawing.page });
  const kept = new Set(next.shapes.map((s) => s.id));
  // Words are written out as the strokes of their font, so each font in use is read first.
  const fonts: Record<string, StrokeFont> = {};
  for (const name of new Set(next.shapes.map((s) => s.font ?? "").filter(Boolean))) fonts[name] = await loadFont(name);
  const svg = buildSvg(next.shapes, drawing.fills.filter((f) => kept.has(f.shapeId)), next.layers, next.page, {
    paperSizeId: sizeIdOf(next.page),
    toolName: drawing.tool ?? "",
    paperColor: drawing.paperColor ?? undefined,
    fonts,
  });
  return postJSON<{ edited: string }>("/api/current", {
    svg,
    name: current.name,
    base: current.opened,
    dirty: true,
    save_to: current.save_to,
    foreign: current.foreign,
  });
}
