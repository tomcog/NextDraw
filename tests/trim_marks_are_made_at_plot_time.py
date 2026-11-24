#!/usr/bin/env python3
"""
Trim marks are generated when the drawing is plotted, not stored in it.

The marks say where a print is cut, so they belong to the artboard - the drawing's own page - and to
the sheet it goes on, not to the artwork. Plot keeps the two numbers in its own metadata block and the
marks are drawn round the artboard in the copy sent to the plotter and the preview (server.py,
add_trim_marks). The same drawing can then go on any sheet with the marks that suit it.

The marks stand OUTSIDE the artboard, so the page grows by their reach on every side and the drawing
moves in by the same amount. That keeps the artwork where it was placed: Plot starts the plot that
much before the artboard's place (trim_pad_mm). A drawing that carries marks drawn into it - made
before this - has them left out in favour of the generated ones, so no drawing ever plots two sets.

Run it from the repository:   .venv/bin/python tests/trim_marks_are_made_at_plot_time.py
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

MARKS = {"length": 6.35, "offset": 3.175}  # a quarter inch long, an eighth off the corner
PAD_IN = (6.35 + 3.175) / 25.4  # 0.375in: how far the marks reach outside the artboard


def fixture(trim=None, stored=False, size='width="8in" height="10in" viewBox="0 0 8 10"'):
    """An 8 x 10 artboard with one layer, plotted with `trim` - and carrying its own marks for
    `stored`, the way Studio drew them before they were generated."""
    plot = {"placement": {"x": 0, "y": 0}, "scale": 100, "tool": "EnerGel"}
    if trim:
        plot["trim"] = trim
    design = {"on": {"art": "Black", "old": "Black"}}
    if stored:
        design["curves"] = [{"shape": "old", "box": [1, 1, 7, 9], "kind": "trim", "length": 6.35, "offset": 3.175}]
    old_layer = ('<g inkscape:groupmode="layer" inkscape:label="Black - Trim marks" id="layer-old" fill="none" stroke="#231f20">'
                 '<path id="old" d="M 0.5 1 L 0.875 1"/></g>') if stored else ""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:nds="https://github.com/tomcog/NextDraw"
     {size}>
  <metadata id="nextdraw-plot"><nds:plot>{json.dumps(plot)}</nds:plot></metadata>
  <metadata id="nextdraw-studio"><nds:design>{json.dumps(design)}</nds:design></metadata>
  <g inkscape:groupmode="layer" inkscape:label="Black" id="layer-art" fill="none" stroke="#231f20" stroke-width="0.008">
    <polyline id="art" points="1,1 7,1 7,9"/>
  </g>
  {old_layer}
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


def made(trim=None, **kwargs):
    # The marks come with the plot request, as the scale and the turn do; the drawing's block is only
    # where Plot keeps them between plots, so the fixture carries them too.
    root = etree.fromstring(fixture(trim=trim, **kwargs).encode())
    pad = server.add_plot_extras(root, {"trim": server.clean_trim(trim)})
    return root, pad[0]


def runs(layer):
    """Each mark as the four numbers of its line, where it lands on the page: the marks are drawn in
    the page as it was and the whole layer is moved in with the drawing, so its move counts."""
    at = re.match(r"translate\(([-\d.e]+) ([-\d.e]+)\)", layer.get("transform") or "translate(0 0)")
    dx, dy = float(at.group(1)), float(at.group(2))
    out = []
    for path in layer:
        d = path.get("d").split()
        out.append((float(d[1]) + dx, float(d[2]) + dy, float(d[4]) + dx, float(d[5]) + dy))
    return out


print("The marks are drawn round the artboard, and the page grows for them:")
root, pad = made(trim=MARKS)
near("the page grew by the marks' reach", pad, 9.525)
check("the page is the artboard plus that on every side", (root.get("width"), root.get("height")), ("8.75in", "10.75in"))
check("and so is its viewBox", root.get("viewBox"), "0 0 8.75 10.75")
check("the drawing moved in by the same", [g.get("transform") for g in server.layer_groups(root) if g.get("id") == "layer-art"],
      ["translate(0.375 0.375)"])
marks = [g for g in server.layer_groups(root) if g.get("id") == server.TRIM_LAYER_ID]
check("the marks are a layer of their own", len(marks), 1)
check("named after the label, so Plot shows what it is", marks[0].get(server.INKSCAPE_NS + "label"), "Trim marks")
check("two marks at each of the four corners", len(marks[0]), 8)
# The artboard now sits at 0.375 in from the page's corner, 8 x 10 as it always was.
x0 = y0 = PAD_IN
x1, y1 = x0 + 8, y0 + 10
gap, length = 3.175 / 25.4, 6.35 / 25.4
def rounded(pairs):
    return [tuple(round(v, 6) for v in run) for run in pairs]


def want(*runs_in):
    return [tuple(round(v, 6) for v in run) for run in runs_in]


check("the top left pair runs out from the corner, drawn inward",
      rounded(runs(marks[0])[:2]),
      want((x0 - gap - length, y0, x0 - gap, y0), (x0, y0 - gap - length, x0, y0 - gap)))
check("the bottom right pair the other way", rounded(runs(marks[0])[4:6]),
      want((x1 + gap + length, y1, x1 + gap, y1), (x1, y1 + gap + length, x1, y1 + gap)))
check("nothing is drawn inside the artboard",
      [r for r in runs(marks[0]) if x0 < r[0] < x1 and y0 < r[1] < y1], [])

print("\nA drawing that carries its own marks has them left out, not plotted twice:")
root, _ = made(trim=MARKS, stored=True)
check("the stored marks are gone", root.findall(".//*[@id='old']"), [])
check("their layer with them, and the generated ones in its place",
      [g.get("id") for g in server.layer_groups(root)], ["layer-art", server.TRIM_LAYER_ID])
# Studio reads a drawing made before this as plain lines on a layer still named for the marks, so the
# layer's own name is the other way to know them - the design block no longer says what they are.
text, gone = re.subn(r', "curves": \[[^]]*\]', "", fixture(trim=MARKS, stored=True))
assert gone == 1, "the fixture should have had a curves entry to take out"
plain = etree.fromstring(text.encode())
server.add_plot_extras(plain, {"trim": server.clean_trim(MARKS)})
check("a drawing Studio has saved since, with only the layer's name to go by",
      [g.get("id") for g in server.layer_groups(plain)], ["layer-art", server.TRIM_LAYER_ID])

root, pad = made(stored=True)
near("with marks off, the drawing is left exactly as it is", pad, 0.0)
check("its own marks still plot, as they always did",
      [g.get("id") for g in server.layer_groups(root)], ["layer-art", "layer-old"])
check("and the page is untouched", (root.get("width"), root.get("viewBox")), ("8in", "0 0 8 10"))

print("\nThe numbers are read and checked as they come in:")
check("marks off is no marks", server.clean_trim(None), None)
check("a mark with no length is no mark", server.clean_trim({"length": 0, "offset": 3}), None)
check("a negative offset is none", server.clean_trim({"length": 6, "offset": -4}), {"length": 6.0, "offset": 0.0})
check("the pen the marks go down in is kept", server.clean_trim({"length": 6, "offset": 3, "ink": {"tool": "EnerGel", "pen": "Black", "hex": "#231F20"}}),
      {"length": 6.0, "offset": 3.0, "ink": {"tool": "EnerGel", "pen": "Black", "hex": "#231f20"}})
check("a color picked by hand too", server.clean_trim({"length": 6, "offset": 3, "ink": "#AABBCC"}),
      {"length": 6.0, "offset": 3.0, "ink": "#aabbcc"})
near("the page's growth at full size", made(trim=MARKS)[1], 9.525)
near("and at half, since the page is scaled with the marks on it",
     server.add_plot_extras(etree.fromstring(fixture(trim=MARKS).encode()), {"trim": server.clean_trim(MARKS), "scale": 50})[0], 4.7625)
near("no marks, no growth", server.add_plot_extras(etree.fromstring(fixture().encode()), {})[0], 0.0)
root, _ = made(trim={"length": 6.35, "offset": 3.175, "ink": {"tool": "EnerGel", "pen": "Black", "hex": "#231f20"}})
layer = [g for g in server.layer_groups(root) if g.get("id") == server.TRIM_LAYER_ID][0]
check("the layer is named for its pen, so Plot says which to load",
      (layer.get(server.INKSCAPE_NS + "label"), layer.get("stroke")), ("Black - Trim marks", "#231f20"))

print("\nThe drawing keeps Plot's choice, so the next plot of it starts from the same marks:")
kept = server.clean_plot({"trim": {"length": 6.35, "offset": 3.175, "ink": {"tool": "EnerGel", "pen": "Black"}}, "scale": 100})
check("the block holds the two lengths and the pen", kept.get("trim"),
      {"length": 6.35, "offset": 3.175, "ink": {"tool": "EnerGel", "pen": "Black"}})
check("and nothing at all for a print without them", server.clean_plot({"scale": 100}).get("trim"), None)
# An edit in Studio or Image rewrites the drawing; Plot's block is carried over as it was.
edited = server.carry_plot_block(fixture(), etree.fromstring(fixture(trim=MARKS).encode()))
check("an edit in another app leaves them alone",
      server.read_plot(etree.fromstring(edited.encode())).get("trim"), MARKS)

print("\nThe page's own units are what the marks are drawn in:")
# Illustrator writes points, 72 to the inch, with the page in points too.
root, _ = made(trim=MARKS, size='width="576pt" height="720pt" viewBox="0 0 576 720"')
pts = PAD_IN * 72
check("a page in points grows in points", root.get("viewBox"), f"0 0 {576 + 2 * pts:g} {720 + 2 * pts:g}")
layer = [g for g in server.layer_groups(root) if g.get("id") == server.TRIM_LAYER_ID][0]
near("and the marks are the same length on paper", runs(layer)[0][2] - runs(layer)[0][0], length * 72)

print("\nThe NextDraw software plots the grown page whole:")
nd = server.NextDraw(default_logging=False, user_message_fun=lambda text: None)
nd.plot_setup(etree.tostring(made(trim=MARKS)[0], encoding="unicode"))
nd.options.preview = True
nd.options.mode = "plot"
nd.plot_run()
near("the document it plots is the page with the marks' room", nd.svg_width, 8.75, 0.01)
near("and as tall", nd.svg_height, 10.75, 0.01)

print()
if failures:
    print(f"{len(failures)} check(s) failed")
    raise SystemExit(1)
print("All checks passed.")
