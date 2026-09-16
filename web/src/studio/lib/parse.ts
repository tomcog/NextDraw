import type { Fill } from "./hatch";
import { newShapeId, type Page, type Shape } from "./shapes";
import { FILL_GROUP_PREFIX } from "./svg";

// Reading a drawing back in, so work can be picked up again after it's been handed to Plot.
//
// Studio understands the shapes it writes: rectangles, ellipses and lines. A drawing can hold plenty
// it can't - paths, text, an imported illustration - and those are counted rather than quietly
// dropped, because Studio owns the file it saves and saving would be what destroys them. The count
// goes to the caller so it can say so out loud before anything is overwritten.

export interface Opened {
  page: Page;
  shapes: Shape[];
  fills: Fill[];
  /** Drawable elements Studio has no way to represent. Saving over the file would lose them. */
  unsupported: number;
}

const PX_PER_INCH: Record<string, number> = {
  "": 1, px: 1, in: 96, mm: 96 / 25.4, cm: 96 / 2.54, pt: 96 / 72, pc: 16,
};

/** A length like "11in" or "816" in inches, or null when it can't be read. */
function lengthIn(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(-?[\d.]+)\s*([a-z%]*)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const per = PX_PER_INCH[m[2].toLowerCase()];
  if (!Number.isFinite(n) || per === undefined) return null;
  return (n * per) / 96;
}

const numbers = (raw: string | null) =>
  (raw ?? "").trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));

const attr = (el: Element, name: string) => Number(el.getAttribute(name) ?? "0") || 0;

export function parseDrawing(text: string): Opened {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (doc.querySelector("parsererror") || svg.nodeName.toLowerCase() !== "svg") {
    throw new Error("That file isn't an SVG this can read.");
  }

  const box = numbers(svg.getAttribute("viewBox"));
  const hasBox = box.length === 4 && box[2] > 0 && box[3] > 0;
  // The page in inches, and how many of the drawing's own units make one inch. A drawing Studio wrote
  // has a viewBox in inches, so the scale is 1; anything else is converted on the way in.
  const page: Page = {
    w: lengthIn(svg.getAttribute("width")) ?? (hasBox ? box[2] : 11),
    h: lengthIn(svg.getAttribute("height")) ?? (hasBox ? box[3] : 8.5),
  };
  const perInchX = hasBox ? box[2] / page.w : 1;
  const perInchY = hasBox ? box[3] / page.h : 1;
  const originX = hasBox ? box[0] : 0;
  const originY = hasBox ? box[1] : 0;
  const toX = (v: number) => (v - originX) / perInchX;
  const toY = (v: number) => (v - originY) / perInchY;

  const shapes: Shape[] = [];
  let unsupported = 0;

  // A fill's lines are regenerated from its parameters, so reading them back as hundreds of separate
  // line shapes would both double the drawing and cut it loose from the fill that made it.
  const generated = (el: Element) => Boolean(el.closest(`[id^="${FILL_GROUP_PREFIX}"]`));
  const idOf = (el: Element) => el.getAttribute("id") || newShapeId();

  // Which shapes are on a layer NextDraw skips. Read from the file rather than from the parameters,
  // because the layer is what actually decides whether a shape reaches the paper.
  const sources = new Set<string>();
  const onSkippedLayer = (el: Element) => {
    for (let up = el.parentElement; up; up = up.parentElement) {
      const label = up.getAttribute("inkscape:label") ?? up.getAttribute("label");
      if (label?.trim().startsWith("%")) return true;
    }
    return false;
  };

  const noteSource = (el: Element) => {
    const id = idOf(el);
    if (onSkippedLayer(el)) sources.add(id);
    return id;
  };

  for (const el of Array.from(svg.querySelectorAll("*"))) {
    if (generated(el)) continue;
    switch (el.nodeName.toLowerCase()) {
      case "rect": {
        const x = attr(el, "x");
        const y = attr(el, "y");
        shapes.push({
          id: noteSource(el), kind: "rect",
          x: toX(x), y: toY(y),
          x2: toX(x + attr(el, "width")), y2: toY(y + attr(el, "height")),
        });
        break;
      }
      case "ellipse":
      case "circle": {
        const cx = attr(el, "cx");
        const cy = attr(el, "cy");
        const rx = el.nodeName.toLowerCase() === "circle" ? attr(el, "r") : attr(el, "rx");
        const ry = el.nodeName.toLowerCase() === "circle" ? attr(el, "r") : attr(el, "ry");
        shapes.push({
          id: noteSource(el), kind: "ellipse",
          x: toX(cx - rx), y: toY(cy - ry), x2: toX(cx + rx), y2: toY(cy + ry),
        });
        break;
      }
      case "line":
        shapes.push({
          id: noteSource(el), kind: "line",
          x: toX(attr(el, "x1")), y: toY(attr(el, "y1")),
          x2: toX(attr(el, "x2")), y2: toY(attr(el, "y2")),
        });
        break;
      case "path":
      case "polyline":
      case "polygon":
      case "text":
      case "image":
      case "use":
        unsupported++;
        break;
      default:
        break; // svg, g, metadata, defs and the rest draw nothing by themselves
    }
  }

  // Studio's own parameters, if the drawing was made here. A fill whose shape has gone is dropped.
  const ids = new Set(shapes.map((s) => s.id));
  let fills: Fill[] = [];
  const design = svg.getElementsByTagName("nds:design")[0] ?? svg.querySelector("design");
  if (design?.textContent) {
    try {
      const raw = JSON.parse(design.textContent) as { fills?: unknown };
      if (Array.isArray(raw.fills)) {
        fills = raw.fills
          .map((f) => f as Record<string, unknown>)
          .filter((f) => typeof f.shape === "string" && ids.has(f.shape as string))
          .map((f) => ({
            shapeId: f.shape as string,
            angle: Number(f.angle) || 0,
            spacingMm: Number(f.spacing_mm) || 1.5,
            scale: Number(f.scale) || 100,
            // The file's own layout wins over the recorded flag: a shape on a skipped layer was
            // never going to be plotted whatever the parameters happen to say.
            outline: !sources.has(f.shape as string),
          }));
      }
    } catch {
      // unreadable parameters: the drawing still opens, just without its fills
    }
  }

  return { page, shapes, fills, unsupported };
}
