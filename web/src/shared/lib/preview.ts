const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const LENGTH_IN: Record<string, number> = { in: 1, mm: 1 / 25.4, cm: 1 / 2.54, pt: 1 / 72, pc: 1 / 6, px: 1 / 96, "": 1 / 96 };

export interface Preview {
  node: SVGSVGElement;
  widthIn: number;
  heightIn: number;
  layers: number; // artwork layers tagged .pv-layer (same rule as the server); colored by their id
  artworkOnly: boolean; // just the drawing, before the plot simulation adds pen paths
  // Where the lines sit in the page, as fractions of its width and height (0-1); null when there
  // are none to measure. The empty margin around them may run past home, the lines may not.
  ink: { x0: number; y0: number; x1: number; y1: number } | null;
}

function lengthToInches(value: string | null) {
  const match = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(in|mm|cm|pt|pc|px)?\s*$/i.exec(value || "");
  if (!match) return null;
  return Number(match[1]) * LENGTH_IN[(match[2] || "").toLowerCase()];
}

// Turn the NextDraw software's rendered preview SVG into a node we can place on the plotter bed.
export function parsePreview(svgText: string | null): Preview | null {
  if (!svgText) return null;
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName !== "svg") return null;

  // Strip anything that could run code; this is a picture only.
  doc.querySelectorAll("script, foreignObject").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => {
    for (const attr of [...n.attributes]) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) n.removeAttribute(attr.name);
    }
  });

  const viewBox = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  let widthIn = lengthToInches(root.getAttribute("width"));
  let heightIn = lengthToInches(root.getAttribute("height"));
  if (viewBox.length === 4) {
    if (widthIn == null) widthIn = viewBox[2] / 96;
    if (heightIn == null) heightIn = viewBox[3] / 96;
  }
  if (!widthIn || !heightIn) return null;

  const artworkOnly = ![...root.children].some((c) => c.getAttributeNS(INKSCAPE_NS, "label") === "% Preview");
  if (artworkOnly) root.classList.add("pv-artwork");
  for (const child of [...root.children]) {
    const label = child.getAttributeNS(INKSCAPE_NS, "label");
    if (label === "% Preview") {
      for (const g of child.querySelectorAll("g")) {
        const gl = g.getAttributeNS(INKSCAPE_NS, "label");
        if (gl === "Pen-up movement") g.classList.add("pv-up");
        if (gl === "Pen-down movement") g.classList.add("pv-down");
      }
    } else if (!artworkOnly && !["defs", "metadata", "title", "desc", "style"].includes(child.localName)) {
      child.setAttribute("opacity", "0.14"); // faint ghost of the artwork under the pen paths
    }
  }

  // The drawing's own layers: Inkscape layers if there are any, otherwise the top-level groups
  // (Illustrator). Matches read_layers in server.py so data-layer lines up with the Layers card.
  const art = [...root.children].filter((c) => c.localName === "g" && c.getAttributeNS(INKSCAPE_NS, "label") !== "% Preview");
  const inkscapeLayers = art.filter((g) => g.getAttributeNS(INKSCAPE_NS, "groupmode") === "layer");
  // Groups with nothing to draw aren't layers (Illustrator exports can carry empty ones).
  const layerGroups = (inkscapeLayers.length ? inkscapeLayers : art)
    .filter((g) => g.querySelector("path, rect, circle, ellipse, line, polyline, polygon, use"));
  layerGroups.forEach((g) => g.classList.add("pv-layer"));

  const node = document.importNode(root, true) as unknown as SVGSVGElement;
  node.removeAttribute("width");
  node.removeAttribute("height");
  return { node, widthIn, heightIn, layers: layerGroups.length, artworkOnly, ink: measureInk(node, artworkOnly) };
}

// The box around what will be drawn - the simulated pen-down paths when there are any, otherwise the
// artwork - as fractions of the page. Laid out off screen at the page's own size so the browser does
// the transforms; strokes aren't counted, so it's the lines' centres.
function measureInk(node: SVGSVGElement, artworkOnly: boolean): Preview["ink"] {
  const vb = (node.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) return null;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  const svg = node.cloneNode(true) as SVGSVGElement;
  svg.setAttribute("width", String(vb[2]));
  svg.setAttribute("height", String(vb[3]));
  svg.setAttribute("preserveAspectRatio", "none");
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const page = svg.getBoundingClientRect();
    if (!(page.width > 0 && page.height > 0)) return null;
    const parts = artworkOnly
      ? [...svg.querySelectorAll(".pv-layer")]
      : [...svg.querySelectorAll(".pv-down")];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of parts.length ? parts : [...svg.children]) {
      if (["defs", "metadata", "title", "desc", "style"].includes(el.localName)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 || r.height > 0)) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    if (!(x1 >= x0)) return null;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x0: clamp((x0 - page.left) / page.width),
      y0: clamp((y0 - page.top) / page.height),
      x1: clamp((x1 - page.left) / page.width),
      y1: clamp((y1 - page.top) / page.height),
    };
  } finally {
    host.remove();
  }
}
