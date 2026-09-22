import { newFillId, type Fill } from "./hatch";
import { curveFromData } from "./parametric";
import { flattenRun, mapNode, parsePath } from "./path";
import { repeatFromData } from "./repeat";
import { newLayerId, newShapeId, type Layer, type Page, type Shape } from "./shapes";
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
  layers: Layer[];
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
  // A file saved without a page size is sized from its viewBox, which counts in units rather than
  // inches: 72 to the inch for Illustrator's exports, 96 for everyone else's - the same reading
  // Plot's normalize_size makes, so the two apps agree on how big a drawing is.
  const perUnit = /Adobe Illustrator/.test(text.slice(0, 4000)) ? 72 : 96;
  // The page in inches, and how many of the drawing's own units make one inch. A drawing Studio wrote
  // has a viewBox in inches, so the scale is 1; anything else is converted on the way in.
  const page: Page = {
    w: lengthIn(svg.getAttribute("width")) ?? (hasBox ? box[2] / perUnit : 11),
    h: lengthIn(svg.getAttribute("height")) ?? (hasBox ? box[3] / perUnit : 8.5),
  };
  const perInchX = hasBox ? box[2] / page.w : 1;
  const perInchY = hasBox ? box[3] / page.h : 1;
  const originX = hasBox ? box[0] : 0;
  const originY = hasBox ? box[1] : 0;
  const toX = (v: number) => (v - originX) / perInchX;
  const toY = (v: number) => (v - originY) / perInchY;

  const shapes: Shape[] = [];
  let unsupported = 0;

  // Read Studio's own parameters first: they say which polylines are a parametric curve's lines,
  // so those aren't counted as marks this can't edit.
  const designEl = svg.getElementsByTagName("nds:design")[0] ?? svg.querySelector("design");
  let design: {
    fills?: unknown; on?: Record<string, string>; curves?: unknown;
    turned?: Record<string, unknown>; repeats?: Record<string, unknown>; smoothed?: Record<string, unknown>;
    names?: Record<string, unknown>;
    texts?: Record<string, { text?: unknown; font?: unknown; box?: unknown; tracking?: unknown; leading?: unknown }>;
  } = {};
  try {
    design = designEl?.textContent ? JSON.parse(designEl.textContent) : {};
  } catch {
    design = {}; // unreadable parameters: the drawing still opens, just without them
  }
  const savedCurves = (Array.isArray(design.curves) ? design.curves : []) as Record<string, unknown>[];
  const curveIds = new Set(savedCurves.map((c) => String(c.shape)));
  const fromCurve = (id: string) => curveIds.has(id) || [...curveIds].some((c) => id.startsWith(`${c}-`));
  // A text's letters are in the file as paths; the words come from the design block instead.
  const textIds = Object.keys(design.texts ?? {});
  const fromText = (id: string) => textIds.some((base) => id === base || id.startsWith(`${base}-`));
  // A repeated shape's copies are drawn from the shape itself, so only the first of them is read.
  const repeatIds = Object.keys(design.repeats ?? {});
  const isCopy = (id: string) => repeatIds.some((base) => /^-r\d+$/.test(id.slice(base.length)) && id.startsWith(base));

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

  // The layer a shape sits in names the pen that draws it - that's the whole point of naming layers
  // after pens, and it means the file says which pen without depending on Studio's own parameters.
  // A layer's colour comes off the group that holds it, since that's where buildSvg puts it.
  const strokeOf = (el: Element) => {
    for (let up: Element | null = el; up; up = up.parentElement) {
      const stroke = up.getAttribute("stroke");
      if (stroke && stroke !== "none") return stroke;
    }
    return null;
  };

  // Layers come from the groups themselves, in the order the file stacks them - not from the shapes
  // inside them. A layer holding nothing but a hatch fill has no shapes to be found by, and those
  // are skipped on the way past, so building layers from shapes would lose it entirely.
  const layers: Layer[] = [];
  const byGroup = new Map<Element, string>();
  for (const g of Array.from(svg.querySelectorAll("g"))) {
    const label = (g.getAttribute("inkscape:label") ?? g.getAttribute("label"))?.trim();
    if (!label || label.startsWith("%")) continue;
    const id = newLayerId();
    byGroup.set(g, id);
    layers.push({ id, name: label, color: g.getAttribute("stroke") || strokeOf(g) || "#262626" });
  }
  const layerOf = new Map<string, string>(); // shape id -> layer id
  const layerFor = (el: Element) => {
    for (let up = el.parentElement; up; up = up.parentElement) {
      const id = byGroup.get(up);
      if (id) return id;
    }
    return null;
  };
  const noteSource = (el: Element) => {
    const id = idOf(el);
    if (onSkippedLayer(el)) sources.add(id);
    const layer = layerFor(el);
    if (layer) layerOf.set(id, layer);
    return id;
  };
  // Applied once every shape is read, since the flag belongs to the shape rather than to its fills.
  const markOutlines = () =>
    shapes.forEach((s) => {
      if (sources.has(s.id)) s.outline = false;
      const layer = layerOf.get(s.id);
      if (layer) s.layerId = layer;
    });

  for (const el of Array.from(svg.querySelectorAll("*"))) {
    if (generated(el) || isCopy(el.getAttribute("id") || "")) continue;
    switch (el.nodeName.toLowerCase()) {
      case "rect": {
        const x = attr(el, "x");
        const y = attr(el, "y");
        shapes.push({
          id: noteSource(el), layerId: "", kind: "rect",
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
          id: noteSource(el), layerId: "", kind: "ellipse",
          x: toX(cx - rx), y: toY(cy - ry), x2: toX(cx + rx), y2: toY(cy + ry),
        });
        break;
      }
      case "line":
        shapes.push({
          id: noteSource(el), layerId: "", kind: "line",
          x: toX(attr(el, "x1")), y: toY(attr(el, "y1")),
          x2: toX(attr(el, "x2")), y2: toY(attr(el, "y2")),
        });
        break;
      case "polyline":
      case "polygon": {
        // A curve's own lines: rebuilt from the design block below, like a fill's. A curve drawn in
        // several passes numbers them after its own id, so the later ones are matched by their start.
        if (fromCurve(el.getAttribute("id") || "")) break;
        // Anything else drawn through points is a path: every point of it can be dragged.
        const nums = numbers(el.getAttribute("points"));
        const points = nums.slice(0, nums.length - (nums.length % 2))
          .reduce<{ x: number; y: number }[]>((acc, v, i) => {
            if (i % 2) acc.push({ x: toX(nums[i - 1]), y: toY(v) });
            return acc;
          }, []);
        if (points.length < 2) {
          unsupported++;
          break;
        }
        if (el.nodeName.toLowerCase() === "polygon") points.push(points[0]); // a polygon closes itself
        const pb = {
          x0: Math.min(...points.map((p) => p.x)), y0: Math.min(...points.map((p) => p.y)),
          x1: Math.max(...points.map((p) => p.x)), y1: Math.max(...points.map((p) => p.y)),
        };
        shapes.push({
          id: noteSource(el), layerId: "", kind: "path", points,
          x: pb.x0, y: pb.y0, x2: pb.x1, y2: pb.y1,
        });
        break;
      }
      case "path": {
        if (fromText(el.getAttribute("id") || "")) break;
        // Moves, lines and curves become runs of nodes: a shape that can be edited here, rather
        // than a mark that can only be counted, with every curve kept as the handles the file drew
        // it with - so what is read is what was written, point for point. Only an arc is walked
        // out, at a hundredth of an inch measured in whatever units this file counts in.
        const runs = parsePath(el.getAttribute("d") || "", 0.01 * Math.max(perInchX, perInchY))
          .map((run) => run.map((n) => mapNode(n, (p) => ({ x: toX(p.x), y: toY(p.y) }))))
          .filter((run) => run.length > 1);
        if (!runs.length) {
          unsupported++;
          break;
        }
        // The box round what is drawn, curves included: a curve can bulge past its nodes.
        const all = runs.flatMap((run) => flattenRun(run));
        shapes.push({
          id: noteSource(el), layerId: "", kind: "path",
          ...(runs.length > 1 ? { runs } : { points: runs[0] }),
          x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)),
          x2: Math.max(...all.map((p) => p.x)), y2: Math.max(...all.map((p) => p.y)),
        });
        break;
      }
      case "text":
      case "image":
      case "use":
        unsupported++;
        break;
      default:
        break; // svg, g, metadata, defs and the rest draw nothing by themselves
    }
  }

  // Each saved text becomes one shape again: the words, the font, and the box they were set in.
  for (const [id, saved] of Object.entries(design.texts ?? {})) {
    const box = Array.isArray(saved?.box) ? (saved.box as unknown[]).map(Number) : [];
    if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) continue;
    const el = svg.querySelector(`[id="${CSS.escape(id)}"]`);
    shapes.push({
      id: el ? noteSource(el) : id, layerId: "", kind: "text",
      text: typeof saved.text === "string" ? saved.text : "",
      font: typeof saved.font === "string" ? saved.font : "",
      ...(Number.isFinite(Number(saved.tracking)) ? { tracking: Number(saved.tracking) } : {}),
      ...(Number.isFinite(Number(saved.leading)) ? { leading: Number(saved.leading) } : {}),
      x: box[0], y: box[1], x2: box[2], y2: box[3],
    });
  }

  // Each saved curve becomes one shape again, in the box it was drawn in.
  for (const saved of savedCurves) {
    const curve = curveFromData(saved);
    const box = Array.isArray(saved.box) ? (saved.box as unknown[]).map(Number) : [];
    if (!curve || box.length !== 4 || box.some((v) => !Number.isFinite(v))) continue;
    const el = svg.querySelector(`[id="${CSS.escape(String(saved.shape))}"]`);
    shapes.push({
      id: el ? noteSource(el) : String(saved.shape),
      layerId: "", kind: "curve", curve,
      x: box[0], y: box[1], x2: box[2], y2: box[3],
    });
  }

  // How each repeated shape repeats, put back on the one shape its copies were drawn from.
  for (const s of shapes) {
    const repeat = repeatFromData(design.repeats?.[s.id]);
    if (repeat) s.repeat = repeat;
  }

  // What each shape has been called, for the ones that were given a name.
  for (const s of shapes) {
    const name = design.names?.[s.id];
    if (typeof name === "string" && name.trim()) s.name = name.trim();
  }

  // The points behind each smoothed path. What's in the file is the curve walked out into segments;
  // these are the few points it was drawn through, which are what there is to edit.
  for (const s of shapes) {
    const saved = design.smoothed?.[s.id];
    if (!Array.isArray(saved)) continue;
    const runs = (saved as unknown[])
      .map((run) => (Array.isArray(run)
        ? run
          .map((pt) => (Array.isArray(pt) ? { x: Number(pt[0]), y: Number(pt[1]) } : null))
          .filter((pt): pt is { x: number; y: number } => !!pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
        : []))
      .filter((run) => run.length > 1);
    if (!runs.length) continue;
    s.kind = "path";
    s.smooth = true;
    s.runs = runs.length > 1 ? runs : undefined;
    s.points = runs.length > 1 ? undefined : runs[0];
  }

  // A path from somewhere else is drawn as the points it came with, and nothing is guessed about
  // them. Its curves were walked out into those points on the way in, exactly as the file drew
  // them; a curve fitted back through the samples would be a second, different curve, and on a
  // drawing of many short strokes it costs more than everything else the preview does. Only what
  // Studio makes itself is smoothed - a baked curve, a simplified path - where the points are sparse
  // and the curve is the intent.

  // The angle each turned shape was drawn at. The geometry in the file is already turned, so this
  // is what puts the shape back the way Studio holds it: a square box plus an angle.
  for (const s of shapes) {
    const deg = Number(design.turned?.[s.id]);
    if (Number.isFinite(deg) && deg) s.rotation = deg;
  }

  markOutlines();

  // Studio's own parameters, if the drawing was made here. A fill whose shape has gone is dropped.
  const ids = new Set(shapes.map((s) => s.id));
  let fills: Fill[] = [];
  {
    {
      const raw = design;
      // A shape on %sources has no layer of its own to belong to, so the block names the one it is
      // on. Names survive the trip; Studio's internal ids don't.
      if (raw.on) {
        shapes.forEach((s) => {
          if (s.layerId) return;
          s.layerId = layers.find((l) => l.name === raw.on?.[s.id])?.id ?? "";
        });
      }
      if (Array.isArray(raw.fills)) {
        fills = raw.fills
          .map((f) => f as Record<string, unknown>)
          .filter((f) => typeof f.shape === "string" && ids.has(f.shape as string))
          .map((f) => ({
            id: typeof f.id === "string" ? f.id : newFillId(),
            shapeId: f.shape as string,
            angle: Number(f.angle) || 0,
            spacingMm: Number(f.spacing_mm) || 1.5,
            scale: Number(f.scale) || 100,
            connected: f.connected === true,
            custom: f.custom === true,
            ...(typeof f.kind === "string" ? { kind: f.kind as Fill["kind"] } : {}),
            ...(Number.isFinite(Number(f.wave_mm)) ? { waveMm: Number(f.wave_mm) } : {}),
            ...(Number.isFinite(Number(f.swing_mm)) ? { swingMm: Number(f.swing_mm) } : {}),
            ...(Number.isFinite(Number(f.dash_mm)) ? { dashMm: Number(f.dash_mm) } : {}),
            ...(Number.isFinite(Number(f.gap_mm)) ? { gapMm: Number(f.gap_mm) } : {}),
          }));
      }
    }
  }

  // A drawing with nothing Studio recognises still needs somewhere to draw.
  if (!layers.length) layers.push({ id: newLayerId(), name: "Black", color: "#262626" });
  shapes.forEach((s) => {
    if (!s.layerId) s.layerId = layers[0].id;
  });

  return { page, shapes, layers, fills, unsupported };
}
