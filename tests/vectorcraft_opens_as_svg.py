#!/usr/bin/env python3
"""
A VectorCraft file opens as an SVG made next to it, as an Illustrator file does.

VectorCraft saves JSON: artboards, then layers of paths whose anchors carry their Bezier handles, in
points, y down. The server reads it itself (server.py, vectorcraft_svg). What has to hold:

- The page is the first artboard, in inches; coordinates stay points, in its viewBox.
- Each layer is an Inkscape layer with its name, in the file's order (bottom first); a hidden or
  non-printing layer comes across hidden, so it isn't plotted.
- A segment with no handles is a line; one with handles a curve through them; a closed subpath closes.
- Fills and strokes keep their colours, CMYK made RGB; groups keep their children.
- A layer whose fills are all one swatch is named after its pen: "EnerGel Pink" is Pink, as the
  preset's palette spells it; a name of its own follows ("Pink - Petals"), VectorCraft's "Layer 1" doesn't.
- Anything else VectorCraft holds (text, images...) is left out and listed.

Run it from the repository:   .venv/bin/python tests/vectorcraft_opens_as_svg.py
It needs nothing running: no server, no plotter.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
from lxml import etree  # noqa: E402

fill = lambda color, swatch=None: {"items": [{"kind": "fill", "paint": {"type": "solid", "color": color, **({"swatch": swatch} if swatch else {})}},  # noqa: E731
                                {"kind": "stroke", "paint": {"type": "none"}, "width": 1.0}]}
square = {"subpaths": [{"anchors": [{"p": [10, 10]}, {"p": [20, 10]}, {"p": [20, 20]}], "closed": True}]}
curve = {"subpaths": [{"anchors": [{"p": [0, 0], "out": [5, 0]}, {"p": [10, 10], "in": [10, 5]}], "closed": False}]}
doc = {"format": "vectorcraft", "generator": "VectorCraft 0.11.0", "document": {
    "artboards": [{"rect": {"x0": 0, "y0": 0, "x1": 792, "y1": 612}}],
    "layers": [
        {"id": 1, "name": "Pink", "kind": {"type": "layer", "printable": True, "children": [
            {"id": 5, "appearance": fill({"model": "rgb", "r": 1, "g": 0, "b": 0.5}, "EnerGel pink"), "kind": {"type": "path", "path": square}},
            {"id": 6, "kind": {"type": "group", "children": [
                {"id": 7, "appearance": {"items": [{"kind": "stroke", "paint": {"type": "solid", "color": {"model": "cmyk", "c": 0, "m": 0, "y": 0, "k": 1}}, "width": 2}]},
                 "kind": {"type": "path", "path": curve}}]}},
            {"id": 8, "kind": {"type": "text"}},
        ]}},
        {"id": 3, "name": "Layer 3", "kind": {"type": "layer", "children": [
            {"id": 10, "appearance": fill({"model": "gray", "k": 0.5}, "Teal"), "kind": {"type": "path", "path": square}}]}},
        {"id": 4, "name": "Layer 4", "kind": {"type": "layer", "children": [
            {"id": 11, "appearance": fill({"model": "rgb", "r": 0, "g": 0, "b": 0}, "EnerGel Black"), "kind": {"type": "path", "path": square}},
            {"id": 12, "appearance": fill({"model": "rgb", "r": 0, "g": 0, "b": 1}, "EnerGel Blue"), "kind": {"type": "path", "path": square}}]}},
        {"id": 2, "name": "Guides", "kind": {"type": "layer", "printable": False, "children": [{"id": 9, "kind": {"type": "path", "path": square}}]}},
    ]}}

PRESETS = [{"name": "Energel", "palette": [{"name": "Black"}]}, {"name": "EnerGel", "palette": [{"name": "Pink"}, {"name": "Black"}]}]
doc["document"]["layers"][0]["name"] = "Petals"
svg, left_out = server.vectorcraft_svg(doc, PRESETS)
root = etree.fromstring(svg.encode())
assert (root.get("width"), root.get("height"), root.get("viewBox")) == ("11in", "8.5in", "0 0 792 612"), svg[:300]
layers = server.layer_groups(root)
labels = [g.get(server.INKSCAPE_NS + "label") for g in layers]
assert labels == ["Pink - Petals", "Teal", "Layer 4", "Guides"], labels
assert not server.layer_hidden(layers[0]) and server.layer_hidden(layers[3]), "a non-printing layer is hidden"
paths = layers[0].findall(".//" + server.SVG_NS + "path")
assert paths[0].get("d") == "M10,10L20,10L20,20L10,10Z", paths[0].get("d")
assert paths[0].get("fill") == "#ff0080" and paths[0].get("stroke") is None
assert paths[1].getparent().tag == server.SVG_NS + "g", "a group keeps its children"
assert paths[1].get("d") == "M0,0C5,0 10,5 10,10", paths[1].get("d")
assert (paths[1].get("fill"), paths[1].get("stroke"), paths[1].get("stroke-width")) == ("none", "#000000", "2")
assert left_out == ["text"], left_out
assert layers[1].find(server.SVG_NS + "path").get("fill") == "#808080", "a gray is its K inverted"
print("ok: a VectorCraft file reads as an SVG")
