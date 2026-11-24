#!/usr/bin/env python3
"""
A drawing that separates its colors by mark rather than by group opens as one layer per color.

A flat illustration out of Illustrator or VectorCraft is four fills inside one <g id="Layer_1">, and
no strokes at all. Both apps read a layer's color from its strokes and took layers from the top-level
groups, so such a file opened as one layer called "Layer 1", colored black - the whole separation
lost (Tom, 2026-11-24). This walks the split and, just as important, the files it must not touch.

Run it from the repository:   python3 tests/a_flat_illustration_opens_as_one_layer_per_color.py
It needs nothing running. It works in a temporary folder of its own.
"""
import importlib.util
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

# Painted by class, named by id, all in one group: how a flat illustration is exported.
FLAT = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="6in" height="4in" viewBox="0 0 432 288">
  <defs><style>.cls-1{fill:#1a5d80}.cls-2{fill:#ea2a4d}.cls-3{fill:#fdaa1c}</style></defs>
  <g id="Layer_1" data-name="Layer 1">
    <path id="Blue" class="cls-1" d="M 10 10 L 100 10 L 100 100 Z"/>
    <path id="Red" class="cls-2" d="M 110 10 L 200 10 L 200 100 Z"/>
    <path id="Blue2" class="cls-1" d="M 10 110 L 100 110 L 100 200 Z"/>
    <path id="Orange" class="cls-3" d="M 210 10 L 300 10 L 300 100 Z"/>
  </g>
</svg>
"""

# The same drawing, but the file says which groups are its layers. Nothing may be rearranged.
DECLARED = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="6in" height="4in" viewBox="0 0 432 288">
  <g inkscape:groupmode="layer" inkscape:label="Everything">
    <path stroke="#1a5d80" fill="none" d="M 10 10 L 100 10"/>
    <path stroke="#ea2a4d" fill="none" d="M 110 10 L 200 10"/>
  </g>
</svg>
"""

# One group, one color: already a layer, and it must come out of this untouched.
PLAIN = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="6in" height="4in" viewBox="0 0 432 288">
  <g id="Art"><path stroke="#231f20" fill="none" d="M 10 10 L 400 270"/></g>
</svg>
"""

# A child drawn in two colors: taking it apart would be guesswork, so the group stays one layer.
MIXED = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="6in" height="4in" viewBox="0 0 432 288">
  <g id="Art">
    <g id="Pair">
      <path stroke="#1a5d80" fill="none" d="M 10 10 L 100 10"/>
      <path stroke="#ea2a4d" fill="none" d="M 110 10 L 200 10"/>
    </g>
  </g>
</svg>
"""

failures = []


def check(what, ok):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


def layers_of(path):
    return server.read_layers(server.parse_svg(path).getroot())


def main():
    folder = Path(tempfile.mkdtemp())

    flat = folder / "flat.svg"
    flat.write_text(FLAT)
    check("as the file stands it is one layer holding every color",
          [(l["name"], l["color"], l["shapes"]) for l in layers_of(flat)] == [("Layer 1", "#1a5d80", 4)])

    server.split_layers_by_color(flat)
    found = layers_of(flat)
    check("every color becomes a layer", len(found) == 3)
    check("in the order the colors first appear",
          [l["color"] for l in found] == ["#1a5d80", "#ea2a4d", "#fdaa1c"])
    # "Blue" and "Blue2" don't agree on a name, so that layer falls back to its color; the other two
    # have one mark each and keep the name it carries.
    check("named by the marks that make them up, where they agree",
          [l["name"] for l in found] == ["#1a5d80", "Red", "Orange"])
    check("the two blue paths land on the one blue layer", found[0]["shapes"] == 2)
    check("nothing is lost", sum(l["shapes"] for l in found) == 4)

    again = flat.read_bytes()
    server.split_layers_by_color(flat)
    check("opening it a second time changes nothing", flat.read_bytes() == again)

    for name, text, why in (
        ("declared.svg", DECLARED, "a file that names its own layers is left as it is"),
        ("plain.svg", PLAIN, "a group of one color is already a layer"),
        ("mixed.svg", MIXED, "a child drawn in two colors stops the split"),
    ):
        path = folder / name
        path.write_text(text)
        before = path.read_bytes()
        server.split_layers_by_color(path)
        check(why, path.read_bytes() == before)

    # The color a layer reports, now that a fill counts: the point of the whole exercise.
    fills = folder / "fills.svg"
    fills.write_text(FLAT.replace('<g id="Layer_1" data-name="Layer 1">', '<g id="Blue only">')
                         .replace('class="cls-2"', 'class="cls-1"').replace('class="cls-3"', 'class="cls-1"'))
    check("a layer painted by fill alone reports its color", layers_of(fills)[0]["color"] == "#1a5d80")

    print("\nall passed" if not failures else f"\n{len(failures)} failed")
    sys.exit(1 if failures else 0)


main()
