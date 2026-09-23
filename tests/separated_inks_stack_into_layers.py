#!/usr/bin/env python3
"""
Files separated by ink stack back into one drawing, a layer each, and line up.

Artwork often reaches the apps already separated: one file per colour, each a single colour on a
single layer, all exported from the same artboard. Combining them is only worth anything if three
things hold, and each has a way of quietly failing:

- They register. A mark one inch in from the corner of every file lands in the same place, whatever
  units each file was written in - Illustrator's points, Inkscape's millimetres - or the colours
  plot out of step with each other.
- Each keeps its own colour. Illustrator names its classes .st0, .st1 ... in every file it exports,
  so stacked as they are, the black file's .st0 and the orange file's .st0 are one class, and
  whichever style came last colours both layers.
- The originals are never touched. The combined drawing is a new file next to them; adding to it
  rewrites that file, and adding to any other drawing makes a new one.

And a file whose page isn't the same size is said so, rather than stacked as if it were: Studio
lines those up by hand.

Run it from the repository:   python3 tests/separated_inks_stack_into_layers.py
It needs nothing running: no server, no plotter. It works in a temporary folder, and never opens
anything in a Plot that is running.
"""
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

# Two Illustrator exports of a letter-landscape artboard: points, no page size, and both using .st0 -
# one black, one orange. Each has a stroke starting one inch in from the corner (72 points).
ILLUSTRATOR = '''<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 28.0.0, SVG Export Plug-In . SVG Version: 1.2.0 Build 136)  -->
<svg xmlns="http://www.w3.org/2000/svg" id="Layer_1" viewBox="0 0 792 612">
  <defs><style>.st0{{fill:none;stroke:{color};stroke-width:.5px}}</style></defs>
  <g id="{layer}"><path class="st0" d="M72 72 L144 72"/></g>
</svg>
'''
# The same artboard from Inkscape, in millimetres: its stroke starts one inch in too (25.4 mm).
INKSCAPE = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="279.4mm" height="215.9mm" viewBox="0 0 279.4 215.9">
  <g inkscape:groupmode="layer" inkscape:label="Layer 1" style="fill:none;stroke:#0086b2">
    <path d="M25.4 25.4 L50.8 25.4"/>
  </g>
</svg>
'''
# Illustrator's other way: the whole look written onto every mark, the same on each but the width.
INLINE = '''<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 30.8.1, SVG Export Plug-In . SVG Version: 9.03 Build 0)  -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 792 612">
<g>
	<line style="fill:none;stroke:#2E7D32;stroke-width:0.85;stroke-linecap:round" x1="72" y1="72" x2="144" y2="72"/>
	<line style="fill:none;stroke:#2E7D32;stroke-width:0.85;stroke-linecap:round" x1="72" y1="80" x2="144" y2="80"/>
	<line style="fill:none;stroke:#2E7D32;stroke-width:1.5;stroke-linecap:round" x1="72" y1="88" x2="144" y2="88"/>
</g>
</svg>
'''
# A page of another size.
SMALL = '''<svg xmlns="http://www.w3.org/2000/svg" width="5in" height="5in" viewBox="0 0 5 5">
  <path d="M1 1 L2 1" stroke="#d6322b" fill="none"/>
</svg>
'''

failures = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def start_in(root, layer):
    """Where a layer's first stroke starts, in the combined page's units: its M, through its transform."""
    path = next(layer.iter(server.SVG_NS + "path"))
    x, y = (float(v) for v in re.match(r"M\s*([-\d.]+)[\s,]+([-\d.]+)", path.get("d")).groups())
    m = re.match(r"matrix\(([^)]*)\)", layer.get("transform") or "matrix(1 0 0 1 0 0)")
    a, _, _, d, e, f = (float(v) for v in m.group(1).split())
    return round(a * x + e, 6), round(d * y + f, 6)


with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp).resolve()  # /var is /private/var on a Mac, and the server resolves paths
    (folder / "black.svg").write_text(ILLUSTRATOR.format(color="#000000", layer="Black"))
    (folder / "orange.svg").write_text(ILLUSTRATOR.format(color="#E86A1F", layer="Orange"))
    (folder / "blue.svg").write_text(INKSCAPE)
    (folder / "small.svg").write_text(SMALL)
    (folder / "green.svg").write_text(INLINE)
    originals = {p.name: p.read_bytes() for p in folder.iterdir()}

    # Keep everything in the temporary folder: the loaded drawing too, so a Plot that happens to be
    # running keeps the one it has.
    server.allowed_folders = lambda: [folder]
    jobs = folder / "jobs"
    jobs.mkdir()
    server.JOBS = jobs
    for name, file in (("CURRENT_SVG", "current.svg"), ("CURRENT_MTIME", "current.mtime"),
                       ("CURRENT_OPENED", "current.opened"), ("CURRENT_HASH", "current.hash"),
                       ("CURRENT_PATH", "current.path"), ("RESUME_SVG", "resume.svg"),
                       ("RESUME_META", "resume.json"), ("PLOT_PATHS", "plot-paths.svg")):
        setattr(server, name, jobs / file)
    client = server.app.test_client()

    # --- Studio: combined and handed back, nothing written.
    res = client.post("/api/studio/combine", json={"paths": [str(folder / n) for n in ("black.svg", "orange.svg", "blue.svg")]}).get_json()
    check("svg" in res, f"Studio gets the combined drawing back ({res.get('error', 'ok')})")
    from lxml import etree
    root = etree.fromstring(res["svg"].encode())
    layers = server.read_layers(root)
    check([l["name"] for l in layers] == ["black", "orange", "blue"], f"a layer per file, named after it, bottom first: {[l['name'] for l in layers]}")
    check([l["color"] for l in layers] == ["#000000", "#e86a1f", "#0086b2"], f"each layer keeps its own colour: {[l['color'] for l in layers]}")
    starts = [start_in(root, g) for g in server.layer_groups(root)]
    check(len(set(starts)) == 1 and starts[0] == (72.0, 72.0), f"an inch in lands in the same place in every file: {starts}")
    check(res["mismatched"] == [], "same-sized pages aren't flagged")
    check(res["name"] == "black combined.svg", f"named after the first file: {res['name']}")
    check(not (folder / "black combined.svg").exists(), "Studio's combine writes nothing: Studio saves it")

    # What every mark says the same way is said once, on the layer; what differs stays on the mark.
    res = client.post("/api/studio/combine", json={"paths": [str(folder / "black.svg"), str(folder / "green.svg")]}).get_json()
    root = etree.fromstring(res["svg"].encode())
    green = server.layer_groups(root)[1]
    marks = list(green.iter(server.SVG_NS + "line"))
    check("stroke:#2E7D32" in (green.get("style") or "") and "stroke-linecap:round" in green.get("style"), f"the shared look moves to the layer: {green.get('style')}")
    check([m.get("style") for m in marks] == ["stroke-width:0.85", "stroke-width:0.85", "stroke-width:1.5"], f"what differs stays on the mark: {[m.get('style') for m in marks]}")
    check(server.read_layers(root)[1]["color"] == "#2e7d32", "and the layer still reads as its colour")

    res = client.post("/api/studio/combine", json={"paths": [str(folder / "black.svg"), str(folder / "small.svg")]}).get_json()
    check(res.get("mismatched") == ["small"], f"a page of another size is flagged: {res.get('mismatched')}")

    # Studio adding to the drawing it has open: the files go on top, and the open drawing is unchanged.
    base = (folder / "blue.svg").read_text()
    res = client.post("/api/studio/combine", json={"paths": [str(folder / "orange.svg")], "base": base}).get_json()
    root = etree.fromstring(res["svg"].encode())
    check([l["name"] for l in server.read_layers(root)] == ["Layer 1", "orange"], "Studio adds a file on top of its open drawing")

    # --- Plot: combined, saved next to the first file, and opened.
    res = client.post("/api/combine", json={"paths": [str(folder / "black.svg"), str(folder / "orange.svg")]}).get_json()
    combined = folder / "black combined.svg"
    check(res.get("path") == str(combined) and combined.exists(), f"Plot saves the combined drawing next to the first file ({res.get('error', 'ok')})")
    check(server.CURRENT_SVG.read_bytes() == combined.read_bytes(), "and opens it")

    res = client.post("/api/combine", json={"paths": [str(folder / "blue.svg")], "add": True}).get_json()
    check(res.get("path") == str(combined), "adding to a combined drawing rewrites it")
    root = server.parse_svg(combined).getroot()
    check([l["name"] for l in server.read_layers(root)] == ["black", "orange", "blue"], "with the new layer on top")

    # Adding to a drawing this didn't make: a new file, and the drawing's own layers still there.
    server.load_drawing(folder / "black.svg")
    res = client.post("/api/combine", json={"paths": [str(folder / "orange.svg")], "add": True}).get_json()
    check(res.get("name") == "black combined 2.svg", f"adding to any other drawing makes a new file: {res.get('name')}")
    root = server.parse_svg(folder / "black combined 2.svg").getroot()
    check([l["name"] for l in server.read_layers(root)] == ["Black", "orange"], f"an Illustrator drawing's layers survive a layer added beside them: {[l['name'] for l in server.read_layers(root)]}")

    check(all((folder / n).read_bytes() == b for n, b in originals.items()), "the original files are untouched")

    # An .ai file whose SVG is already there asks, once, as opening one does.
    (folder / "black.ai").write_text("not really Illustrator")
    res = client.post("/api/combine", json={"paths": [str(folder / "black.ai")]}).get_json()
    check(res.get("choice") is True and res.get("svg_names") == ["black.svg"], "an .ai file with its SVG already there asks first")

    res = client.post("/api/combine", json={"paths": ["/etc/hosts"]})
    check(res.status_code == 403, "a file outside the allowed folders is refused")

print()
print("All good." if not failures else f"{len(failures)} failed.")
sys.exit(1 if failures else 0)
