#!/usr/bin/env python3
"""
Registration blocks are plotted before anything else.

Studio's Registration button puts a small solid square for each layer in the page's lower left
corner, named Registration in the drawing's design block. They are there to show how each colour
landed, and they go down first. The NextDraw software doesn't know that: it orders the paths within
a layer for speed, starting from home in the top left, and reaches a block in the bottom corner last.

So Plot moves each plotted layer's blocks, in the copy sent to the plotter, into a layer of their
own ahead of every layer being plotted (server.py, registration_first). This checks the move - and
then runs the real NextDraw software's optimisation on the result, at the reordering Plot uses, and
checks the first thing the pen draws is the block, where without the move it would be the drawing.

Run it from the repository:   .venv/bin/python tests/registration_blocks_plot_first.py
It needs nothing running: no server, no plotter.
"""
import importlib.util
import sys
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

# Two layers, each with something drawn near home and its block in the bottom left corner.
FIXTURE = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:nds="https://github.com/tomcog/NextDraw"
     width="11in" height="8.5in" viewBox="0 0 11 8.5">
  <metadata id="nextdraw-studio"><nds:design>{"on":{"art-y":"Yellow","reg-y":"Yellow","art-p":"Pink","reg-p":"Pink"},"names":{"reg-y":"Registration","reg-p":"Registration"}}</nds:design></metadata>
  <g inkscape:groupmode="layer" inkscape:label="Yellow" id="layer-y" fill="none" stroke="#ffff00" stroke-width="0.008">
    <polyline id="art-y" points="1,1 3,1 3,2"/>
    <polyline id="reg-y" points="0.5,7.8 0.5,8 0.51,8 0.51,7.8"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Pink" id="layer-p" fill="none" stroke="#ff53c8" stroke-width="0.008">
    <polyline id="art-p" points="1,1.5 3,1.5"/>
    <polyline id="reg-p" points="0.7,7.8 0.7,8 0.71,8 0.71,7.8"/>
  </g>
</svg>'''

failures = []


def check(what, got, want):
    if got == want:
        print(f"  ok    {what}")
    else:
        failures.append(what)
        print(f"  FAIL  {what}\n          wanted {want!r}\n          got    {got!r}")


def moved(layers=None):
    root = etree.fromstring(FIXTURE.encode())
    if layers:
        server.only_layers(root, layers)
    server.registration_first(root)
    return root


def shown_layers(root):
    return [(g.get("id"), [el.get("id") for el in g]) for g in server.layer_groups(root) if not server.layer_hidden(g)]


print("The blocks move ahead of the layers being plotted:")
check("both layers plotted", shown_layers(moved()),
      [("layer-y-registration", ["reg-y"]), ("layer-p-registration", ["reg-p"]), ("layer-y", ["art-y"]), ("layer-p", ["art-p"])])
check("one layer plotted: only its block moves, ahead of it", shown_layers(moved(["layer-p"])),
      [("layer-p-registration", ["reg-p"]), ("layer-p", ["art-p"])])
root = moved()
first = server.layer_groups(root)[0]
check("the block's layer keeps the pen", (first.get(server.INKSCAPE_NS + "label"), first.get("stroke")), ("Yellow", "#ffff00"))
art = server.layer_groups(root)[2]
check("the drawing waits five seconds before it starts", art.get(server.INKSCAPE_NS + "label"), "+d5000Yellow")
check("only the first of it", server.layer_groups(root)[3].get(server.INKSCAPE_NS + "label"), "Pink")
numbered = etree.fromstring('<g xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:label="!13-date"/>')
server.with_delay(numbered, 10000)
check("after a pause and a layer number, before the name", numbered.get(server.INKSCAPE_NS + "label"), "!13+d10000-date")
plain = etree.fromstring(FIXTURE.replace('"names":{"reg-y":"Registration","reg-p":"Registration"}', '"names":{}').encode())
server.registration_first(plain)
check("a drawing with no blocks is left as it is", len(server.layer_groups(plain)), 2)
# A drawing turned in Studio keeps each layer's shapes in a rotate group: the block still moves, in its turn.
turned = etree.fromstring(FIXTURE.replace('<polyline id="reg-y"', '<g transform="rotate(270 5 4)"><polyline id="reg-y"')
                          .replace('0.51,7.8"/>', '0.51,7.8"/></g>', 1).encode())
server.registration_first(turned)
block_layer = server.layer_groups(turned)[0]
check("a turned drawing's block moves, in its turn",
      (block_layer.get("id"), block_layer[0].get("transform"), block_layer[0][0].get("id")),
      ("layer-y-registration", "rotate(270 5 4)", "reg-y"))


def waits_s(svg_text):
    """How long the NextDraw software waits at the starts of layers in the plot, in seconds."""
    nd = server.NextDraw(default_logging=False, user_message_fun=lambda text: None)
    nd.plot_setup(svg_text)
    nd.options.mode = "plot"
    nd.options.preview = True
    nd.plot_run()
    return nd.plot_status.stats.layer_delays / 1000


def first_drawn(svg_text):
    """Where the pen first goes down, after the NextDraw software's own reordering (Plot's default, 2)."""
    nd = server.NextDraw(default_logging=False, user_message_fun=lambda text: None)
    nd.plot_setup(svg_text)
    nd.options.reordering = 2
    nd.options.digest = 2
    nd.options.preview = True
    out = etree.fromstring(nd.plot_run(output=True).encode())
    line = next(out.iter("{http://www.w3.org/2000/svg}polyline"))
    x, y = (float(v) for v in line.get("points").split()[0].split(","))
    return x, y


print("\nThe NextDraw software, reordering for speed, draws the block first:")
before = first_drawn(FIXTURE)
after = first_drawn(etree.tostring(moved(), encoding="unicode"))
check("without the move it starts on the drawing, near home", before[1] < 3, True)
check("with it, the first thing drawn is the block in the bottom corner", after[1] > 7, True)
check("and it waits five seconds, once, after the blocks", (waits_s(FIXTURE), waits_s(etree.tostring(moved(), encoding="unicode"))), (0, 5))

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall passed")
