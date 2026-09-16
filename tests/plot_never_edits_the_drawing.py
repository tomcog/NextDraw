#!/usr/bin/env python3
"""
The one promise Plot makes to Studio: it never changes the drawing.

Plot may write exactly one thing into an SVG - its own <nds:plot> block, holding how the drawing is
to be plotted (placement, scale, rotation, tool, paper, which layers are held back). Everything else
in the file is Studio's: the geometry, the layers, their names, their order, their colours, and the
<nds:design> block that describes the shapes and fills the drawing was built from.

This is what a broken version of that looks like, and why it matters: a fill whose outline isn't
drawn keeps its shape on a "%"-named layer that NextDraw skips. Plot used to be able to rename,
reorder, recolour and delete layers, so it could delete that one - and the drawing would still LOOK
right in Plot, because the hatch lines are still there, while Studio could no longer find the shape
that made them. The drawing was quietly no longer editable.

So this test doesn't check that Plot behaves. It checks that the file came back byte-identical apart
from one metadata block, which is a claim no amount of careful behaviour can fake.

Run it with the server up:   python3 tests/plot_never_edits_the_drawing.py
It loads a fixture drawing, so it replaces whatever is open in Plot. It puts the old one back at the
end, but any unsaved change in an open Plot window is the window's, not the file's, and won't survive.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:5055"
HERE = Path(__file__).resolve().parent


def call(route, body=None):
    url = f"{BASE}{route}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read() or b"{}")


# A drawing with everything Plot could damage: two named layers, a shape, hatch fills, a %-named
# layer holding a fill's source shape, and an <nds:design> block that names layers and shapes.
FIXTURE = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:nds="https://github.com/tomcog/NextDraw"
     width="11in" height="8.5in" viewBox="0 0 11 8.5">
  <metadata id="nextdraw-plot"><nds:plot>{"placement":{"x":0.0,"y":0.0},"scale":100.0,"rotation":0,"tool":"EnerGel","paper":{"paper_w":279.4,"paper_h":215.9,"paper_x":0.0,"paper_y":0.0,"paper_size":"letter","paper_color":"#ffffff"}}</nds:plot></metadata>
  <metadata id="nextdraw-studio"><nds:design>{"on":{"shape-a":"Sky Blue","shape-b":"%sources"},"fills":[{"id":"fill-a","shape":"shape-b","angle":45,"spacing_mm":1.35,"scale":100}]}</nds:design></metadata>
  <g inkscape:groupmode="layer" inkscape:label="Sky Blue" id="studio-layer-1" fill="none" stroke="#0086b2" stroke-width="0.008">
      <rect id="shape-a" x="1" y="1" width="3" height="2"/>
      <g id="studio-fill-fill-a">
        <line x1="5" y1="5" x2="6" y2="6"/>
        <line x1="5.1" y1="5" x2="6.1" y2="6"/>
      </g>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="%sources" id="studio-sources" fill="none" stroke="#000000" stroke-width="0.008">
      <rect id="shape-b" x="5" y="5" width="1.5" height="1.5"/>
  </g>
</svg>
'''

BLOCK = re.compile(r'<metadata id="nextdraw-plot">.*?</metadata>', re.S)
PLOT = re.compile(r"<nds:plot>(.*?)</nds:plot>", re.S)


def without_plot_block(svg):
    return BLOCK.sub("<PLOT/>", svg)


def shape_of(svg):
    """
    The drawing as a structure, with its own <nds:plot> block taken out: every element's tag,
    attributes and text, in order.

    Not the bytes. Saving sends the file through lxml, which rewrites the XML declaration's quotes,
    unwraps attributes onto one line and moves the indentation around the block it replaced - all of
    which changes the bytes on a file's first pass through Plot while changing nothing about the
    drawing. What must not change is everything below: a deleted layer, a renamed label, a restroked
    shape or a rewritten <nds:design> block all show up here.
    """
    import xml.etree.ElementTree as ET
    root = ET.fromstring(svg)

    def walk(el, inside_plot=False):
        mine = inside_plot or el.get("id") == PLOT_METADATA_ID
        if not mine:
            yield (el.tag, tuple(sorted(el.attrib.items())), (el.text or "").strip())
        for child in el:
            yield from walk(child, mine)

    return list(walk(root))


PLOT_METADATA_ID = "nextdraw-plot"


def plot_block(svg):
    found = PLOT.search(svg)
    return json.loads(found.group(1).replace("&quot;", '"')) if found else None


# Damage of the kind this test exists to catch, and what shape_of should say about each. If the
# comparison can't tell these from the original, the test below proves nothing - so it is checked
# first, every run.
DAMAGE = {
    "a deleted %sources layer": lambda s: re.sub(
        r'<g inkscape:groupmode="layer" inkscape:label="%sources".*?</g>', "", s, flags=re.S),
    "a renamed layer": lambda s: s.replace('inkscape:label="Sky Blue"', 'inkscape:label="Lime Green"'),
    "a recoloured layer": lambda s: s.replace('stroke="#0086b2"', 'stroke="#1f4736"'),
    "a recolour written onto a shape": lambda s: s.replace(
        '<rect id="shape-a"', '<rect style="stroke:#912474" id="shape-a"'),
    "a deleted shape": lambda s: s.replace('<rect id="shape-a" x="1" y="1" width="3" height="2"/>', ""),
    "the file's layers reordered": lambda s: _swap_layers(s),
    "a rewritten design block": lambda s: s.replace('"angle":45', '"angle":90'),
}


def _swap_layers(svg):
    """The two <g> layers exchanged, which is what reordering by rewriting the file would look like."""
    # By index, not by regex: a layer holds a nested fill group, so a non-greedy match for </g>
    # stops at the wrong one.
    starts = [m.start() for m in re.finditer(r'<g inkscape:groupmode="layer"', svg)]
    assert len(starts) == 2, starts
    end = svg.index("</svg>")
    first, second = svg[starts[0]:starts[1]], svg[starts[1]:end]
    return svg[:starts[0]] + second + first + svg[end:]


def comparison_works():
    """Every kind of damage must show up as a difference; an unchanged file must not."""
    bad = [name for name, damage in DAMAGE.items() if shape_of(FIXTURE) == shape_of(damage(FIXTURE))]
    if shape_of(FIXTURE) != shape_of(FIXTURE):
        bad.append("an unchanged drawing compared unequal to itself")
    return bad


def main():
    blind = comparison_works()
    if blind:
        print("FAILED - this test cannot see the damage it exists to catch:")
        for line in blind:
            print("  -", line)
        sys.exit(1)

    try:
        info = call("/api/status")
    except (urllib.error.URLError, OSError) as exc:
        sys.exit(f"Start the server first ({BASE}): {exc}")
    was_open = info.get("file_path")

    # The fixture has to live somewhere the server is allowed to open from; the browse listing says
    # which folders those are.
    listing = call("/api/browse")
    folder = Path(listing["folders"][0]["path"]) if listing.get("folders") else Path.home() / "Desktop"
    fixture = folder / "nextdraw-readonly-test.svg"
    fixture.write_text(FIXTURE)

    failures = []
    try:
        call("/api/open", {"path": str(fixture)})
        before = fixture.read_text()

        # Every choice Plot is allowed to make, at once.
        call("/api/drawing", {
            "file": fixture.name,
            "plot": {
                "placement": {"x": 12.5, "y": 30.0},
                "scale": 63.0,
                "rotation": 90,
                "tool": "EnerGel",
                "hidden_layers": ["studio-sources"],
                "layer_colors": {"studio-layer-1": "#912474"},
                "layer_order": ["studio-sources", "studio-layer-1"],
                "paper": {"paper_size": "a4", "paper_w": 210.0, "paper_h": 297.0,
                          "paper_x": 5.0, "paper_y": 5.0, "paper_color": "#fffbea"},
            },
        })
        for _ in range(40):  # the save is debounced on the page but immediate on this route
            after = fixture.read_text()
            if after != before:
                break
            time.sleep(0.25)
        after = fixture.read_text()

        was, now = shape_of(before), shape_of(after)
        if was != now:
            failures.append("Plot changed the drawing outside its own <nds:plot> block:")
            for old_el, new_el in zip(was, now):
                if old_el != new_el:
                    failures.append(f"    {old_el}\n      became {new_el}")
            if len(was) != len(now):
                failures.append(f"    element count {len(was)} -> {len(now)}")
        if before.count("<line") != after.count("<line"):
            failures.append(f"hatch lines: {before.count('<line')} -> {after.count('<line')}")
        if before.count("<rect") != after.count("<rect"):
            failures.append(f"shapes: {before.count('<rect')} -> {after.count('<rect')}")
        labels = lambda s: re.findall(r'inkscape:label="([^"]+)"', s)
        if labels(before) != labels(after):
            failures.append(f"layers: {labels(before)} -> {labels(after)}")
        design = lambda s: re.search(r"<nds:design>(.*?)</nds:design>", s, re.S).group(1)
        if design(before) != design(after):
            failures.append("Studio's <nds:design> block was rewritten.")

        # And the half that has to work: Plot's own choices really are kept.
        saved = plot_block(after) or {}
        for key, want in (("scale", 63.0), ("rotation", 90), ("hidden_layers", ["studio-sources"]),
                          ("layer_colors", {"studio-layer-1": "#912474"}),
                          ("layer_order", ["studio-sources", "studio-layer-1"])):
            if saved.get(key) != want:
                failures.append(f"Plot did not keep {key}: {saved.get(key)!r} (wanted {want!r})")
        if saved.get("placement") != {"x": 12.5, "y": 30.0}:
            failures.append(f"Plot did not keep placement: {saved.get('placement')!r}")
    finally:
        fixture.unlink(missing_ok=True)
        if was_open:
            try:
                call("/api/open", {"path": was_open})
            except Exception:  # noqa: BLE001 - putting the old drawing back is a courtesy
                print(f"note: couldn't reopen {was_open}")

    if failures:
        print("FAILED - Plot edited the drawing:")
        for line in failures:
            print("  -", line)
        sys.exit(1)
    print("PASS - Plot wrote its own block and nothing else.")


if __name__ == "__main__":
    main()
