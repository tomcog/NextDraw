const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const LENGTH_IN: Record<string, number> = { in: 1, mm: 1 / 25.4, cm: 1 / 2.54, pt: 1 / 72, pc: 1 / 6, px: 1 / 96, "": 1 / 96 };

export interface Preview {
  node: SVGSVGElement;
  widthIn: number;
  heightIn: number;
  layers: number; // artwork layers tagged .pv-layer (same rule as the server); colored by their id
  artworkOnly: boolean; // just the drawing, before the plot simulation adds pen paths
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
  const layerGroups = inkscapeLayers.length ? inkscapeLayers : art;
  layerGroups.forEach((g) => g.classList.add("pv-layer"));

  const node = document.importNode(root, true) as unknown as SVGSVGElement;
  node.removeAttribute("width");
  node.removeAttribute("height");
  return { node, widthIn, heightIn, layers: layerGroups.length, artworkOnly };
}
