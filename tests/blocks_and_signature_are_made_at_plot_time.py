#!/usr/bin/env python3
"""
The color blocks and the signature are made when the drawing is plotted, not stamped into it.

Studio used to stamp them as shapes, which is why they went stale: add a layer and the blocks no
longer said what the print was. Plot makes them now, in the copy sent to the plotter and the preview
(server.py, add_plot_extras), from the layers and inks of the version actually being plotted. The
drawing keeps only WHERE they go - an anchor per axis, read as "so far inside or outside the named
edge of the artwork or the artboard" - and the geometry comes with the request, made in the page at
its own size on paper (web/src/shared/lib/drawing/plotStamps.ts).

A block goes inside its own layer, so it plots in that layer's pass and that layer's pen; the
signature gets a layer of its own. Both are the same size on paper whatever size the artwork prints
at, so the page's scale is taken back out of them here.

Run it from the repository:   .venv/bin/python tests/blocks_and_signature_are_made_at_plot_time.py
It needs nothing running: no server, no plotter.
"""
import importlib.util
import json
import re
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

# The artwork sits 1 in inside an 8 x 10 artboard on every side.
ART = [1.0, 1.0, 7.0, 9.0]
BLOCKS = {"w": 0.6, "h": 0.2, "items": [{"layer": "layer-art", "d": "M 0 0 L 0.6 0"}]}
SIGNATURE = {"w": 0.4, "h": 0.25, "d": ["M 0 0 L 0.4 0.25"], "ink": {"tool": "EnerGel", "pen": "Black", "hex": "#231f20"}}
UNDER_ARTWORK = {"x": {"mm": 0, "edge": "left", "side": "inside", "from": "artwork"},
                 "y": {"mm": 12.7, "edge": "bottom", "side": "outside", "from": "artwork"}}


def fixture(stamped=False):
    """An 8 x 10 artboard with one layer - and, for `stamped`, a signature and a block drawn into it
    the way Studio used to."""
    design = {"on": {"art": "Black"}}
    old = ""
    if stamped:
        design["names"] = {"old-block": "Registration"}
        old = ('<g inkscape:groupmode="layer" inkscape:label="Black - Signature" id="layer-sig" fill="none" stroke="#231f20">'
               '<path id="old-sig" d="M 6 9 L 6.4 9.25"/></g>')
    block = '<path id="old-block" d="M 1 9.5 L 1.6 9.5"/>' if stamped else ""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:nds="https://github.com/tomcog/NextDraw"
     width="8in" height="10in" viewBox="0 0 8 10">
  <metadata id="nextdraw-studio"><nds:design>{json.dumps(design)}</nds:design></metadata>
  <g inkscape:groupmode="layer" inkscape:label="Black" id="layer-art" fill="none" stroke="#231f20" stroke-width="0.008">
    <polyline id="art" points="1,1 7,1 7,9 1,9 1,1"/>
    {block}
  </g>
  {old}
</svg>'''


failures = []


def check(what, got, want):
    if got == want:
        print(f"  ok    {what}")
    else:
        failures.append(what)
        print(f"  FAIL  {what}\n          wanted {want!r}\n          got    {got!r}")


def near(what, got, want, tol=1e-6):
    check(what, True if abs(got - want) <= tol else got, True)


def made(blocks=None, signature=None, art=ART, scale=100, stamped=False):
    root = etree.fromstring(fixture(stamped).encode())
    extras = {"scale": scale, "art": art}
    if blocks:
        extras["blocks"] = server.clean_blocks({**UNDER_ARTWORK, **blocks}, geometry=True)
    if signature:
        extras["signature"] = server.clean_signature({**UNDER_ARTWORK, **signature}, geometry=True)
    pad = server.add_plot_extras(root, extras)
    return root, pad, extras


def placed(group):
    """Where a stamp was put, and how big: translate(x y) scale(sx sy) in the page's units."""
    m = re.match(r"translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+) ([-\d.e]+)\)", group.get("transform") or "")
    return [float(m.group(i)) for i in (1, 2, 3, 4)] if m else None


def moved(root, el):
    """How far the layer `el` sits in was moved when the page grew."""
    for child in root:
        if el is child or el in child.iter():
            m = re.match(r"translate\(([-\d.e]+) ([-\d.e]+)\)", child.get("transform") or "translate(0 0)")
            return (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
    return (0.0, 0.0)


print("The blocks go on their own layers, under the artwork:")
root, pad, _ = made(blocks=BLOCKS)
group = root.find(f".//*[@id='{server.BLOCK_ID}layer-art']")
check("the block is inside the layer it belongs to", group.getparent().get("id"), "layer-art")
x, y, sx, sy = placed(group)
near("lined up with the artwork's left edge", x, 1.0)
near("half an inch under its foot", y, 9.5)
near("at its own size, the page being at full size", sx, 1.0)
check("and nothing moved, since it all fits on the artboard", pad, (0.0, 0.0))

print("\nThe signature gets a layer of its own, named for its pen:")
root, _, _ = made(signature={**SIGNATURE, "x": {"mm": 0, "edge": "right", "side": "inside", "from": "artwork"}})
layer = root.find(f".//*[@id='{server.SIGNATURE_LAYER_ID}']")
check("a layer Plot's Layers card will list", layer.get(server.INKSCAPE_NS + "label"), "Black - Signature")
check("in the pen's own color", layer.get("stroke"), "#231f20")
x, y, _, _ = placed(layer[0])
near("its right edge against the artwork's", x, 7.0 - 0.4)
near("and half an inch under its foot", y, 9.5)

print("\nWhere they go is read as the card says it:")
check("inside the left edge: the near edges meet",
      server.anchor_at({"edge": "left", "side": "inside"}, 2, (10, 20), 1), 11)
check("outside the left edge: a gap between them",
      server.anchor_at({"edge": "left", "side": "outside"}, 2, (10, 20), 1), 7)
check("inside the right edge", server.anchor_at({"edge": "right", "side": "inside"}, 2, (10, 20), 1), 17)
check("outside the right edge", server.anchor_at({"edge": "right", "side": "outside"}, 2, (10, 20), 1), 21)
root, _, _ = made(blocks={**BLOCKS, "x": {"mm": 0, "edge": "left", "side": "inside", "from": "artboard"},
                          "y": {"mm": 0, "edge": "top", "side": "inside", "from": "artboard"}})
x, y, _, _ = placed(root.find(f".//*[@id='{server.BLOCK_ID}layer-art']"))
check("measured from the artboard instead, which is the page itself", (x, y), (0.0, 0.0))

print("\nThe page grows for anything that lands outside the artboard:")
root, pad, _ = made(blocks={**BLOCKS, "x": {"mm": 12.7, "edge": "left", "side": "outside", "from": "artwork"},
                            "y": {"mm": 25.4, "edge": "bottom", "side": "outside", "from": "artwork"}})
near("the plot starts that far before the artboard, across", pad[0], 0.1 * 25.4)
check("and not at all down, since the growth is past the far corner", round(pad[1], 9), 0.0)
check("the page is the artboard plus what hangs off it", (root.get("width"), root.get("height")), ("8.1in", "10.2in"))
group = root.find(f".//*[@id='{server.BLOCK_ID}layer-art']")
near("the block still lands where it was placed, the drawing having moved with it",
     placed(group)[0] + moved(root, group)[0], 0.0)

print("\nThey come out the same size on paper whatever size the artwork prints at:")
root, _, _ = made(blocks=BLOCKS, scale=50)
near("at half size the stamp is twice the page's units", placed(root.find(f".//*[@id='{server.BLOCK_ID}layer-art']"))[2], 2.0)

print("\nA drawing that carries stamped ones has them left out:")
root, _, _ = made(blocks=BLOCKS, signature=SIGNATURE, stamped=True)
check("the stamped block is gone", root.findall(".//*[@id='old-block']"), [])
check("the stamped signature's layer with it",
      [g.get("id") for g in server.layer_groups(root)], ["layer-art", server.SIGNATURE_LAYER_ID])
check("and the drawing's own art is untouched", len(root.findall(".//*[@id='art']")), 1)

print("\nEach block plots at the front of its layer's pass, as a stamped one does:")
root, _, extras = made(blocks=BLOCKS)
server.registration_first(root, extras.get("block_ids") or ())
check("a layer of its own, ahead of the drawing",
      [g.get("id") for g in server.layer_groups(root)], ["layer-art-registration", "layer-art"])
check("in the same pen", server.layer_groups(root)[0].get("stroke"), "#231f20")

print("\nWhat the drawing keeps is where they go, never the geometry:")
kept = server.clean_plot({"scale": 100, "blocks": {**UNDER_ARTWORK, **BLOCKS},
                          "signature": {**UNDER_ARTWORK, **SIGNATURE}})
check("the blocks' anchors, and no paths", kept.get("blocks"), UNDER_ARTWORK)
check("the signature's, with its pen", kept.get("signature"), {**UNDER_ARTWORK, "ink": SIGNATURE["ink"]})
check("none of it for a print that gets neither", server.clean_plot({"scale": 100}).get("blocks"), None)

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    raise SystemExit(1)
print("All checks passed.")
