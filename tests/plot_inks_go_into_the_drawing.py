#!/usr/bin/env python3
"""
A layer given another ink in Plot changes the drawing itself, so Studio and Image show it too.

What has to hold:
- the layer takes the pen's name and color, and every mark in it that names a stroke of its own;
- <nds:design> follows the new name, so Studio still finds the shapes on the layer;
- the layer keeps its id, which Plot's order, links and printed marks are kept by;
- the change is one the editors are told of, and isn't saved.

Runs on its own, against a temporary folder:   python3 tests/plot_inks_go_into_the_drawing.py
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

failures = []


def check(what, got, want):
    if got == want:
        print(f"  ok    {what}")
    else:
        failures.append(what)
        print(f"  FAIL  {what}\n          wanted {want!r}\n          got    {got!r}")


DRAWING = (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:nds="https://github.com/tomcog/NextDraw" '
    'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="11in" height="8.5in" viewBox="0 0 11 8.5">'
    '<metadata id="nextdraw-studio"><nds:design>{"on":{"shape-a":"Sky Blue - Leaves","shape-b":"Black"},"fills":[]}</nds:design></metadata>'
    '<g inkscape:groupmode="layer" inkscape:label="Sky Blue - Leaves" id="Sky_Blue_Leaves" fill="none" stroke="#0086b2" stroke-width="0.008">'
    '<path id="shape-a" d="M 1 1 L 5 1"/><path d="M 1 2 L 5 2" style="stroke:#0086b2;stroke-width:0.01"/></g>'
    '<g inkscape:groupmode="layer" inkscape:label="Black" id="Black" fill="none" stroke="#231f20" stroke-width="0.008">'
    '<path id="shape-b" d="M 1 3 L 5 3"/></g></svg>'
)


def main():
    folder = Path(tempfile.mkdtemp())
    jobs = folder / "jobs"
    jobs.mkdir()
    server.DRAWINGS_FOLDER = folder
    server.allowed_folders = lambda: [folder]
    server.JOBS = jobs
    for name, file in (("CURRENT_SVG", "current.svg"), ("CURRENT_MTIME", "current.mtime"),
                       ("CURRENT_OPENED", "current.opened"), ("CURRENT_HASH", "current.hash"),
                       ("CURRENT_PATH", "current.path"), ("CURRENT_STATE", "current.json"),
                       ("RESUME_SVG", "resume.svg"), ("RESUME_META", "resume.json"),
                       ("PLOT_PATHS", "plot-paths.svg"), ("PRINTED_FILE", "printed-layers.json")):
        setattr(server, name, jobs / file)
    client = server.app.test_client()
    file = folder / "leaves.svg"
    file.write_text(DRAWING)
    client.post("/api/open?svg=1", json={"path": str(file)})
    edited = client.get("/api/status").get_json().get("file_edited")

    print("\nSky Blue - Leaves given Marigold")
    res = client.post("/api/current/layer", json={"id": "Sky_Blue_Leaves", "name": "Marigold - Leaves", "color": "#F5A623"})
    check("it's done", res.status_code, 200)
    from lxml import etree
    root = etree.fromstring(server.CURRENT_SVG.read_bytes())
    layers = server.read_layers(root)
    check("the layer is called after the pen, its label kept", layers[0]["name"], "Marigold - Leaves")
    check("and drawn in its color, every mark", (layers[0]["color"], layers[0]["colors"]), ("#f5a623", ["#f5a623"]))
    check("it keeps its id", layers[0]["id"], "Sky_Blue_Leaves")
    design = json.loads(root.find(".//" + server.DESIGN_TAG).text)
    check("Studio still finds its shapes", design["on"], {"shape-a": "Marigold - Leaves", "shape-b": "Black"})
    check("the other layer is as it was", (layers[1]["name"], layers[1]["color"]), ("Black", "#231f20"))
    check("the editors are told", client.get("/api/status").get_json().get("file_edited") != edited, True)
    check("as a change not saved", client.get("/api/current").get_json()["dirty"], True)
    check("the file is untouched", file.read_text(), DRAWING)

    print("\na color with no pen: the name stays")
    client.post("/api/current/layer", json={"id": "Black", "color": "#336699"})
    layers = server.read_layers(etree.fromstring(server.CURRENT_SVG.read_bytes()))
    check("recolored, still called Black", (layers[1]["name"], layers[1]["color"]), ("Black", "#336699"))

    print("\nwhat isn't a layer or a color")
    check("an unknown layer", client.post("/api/current/layer", json={"id": "nope", "color": "#000000"}).status_code, 404)
    check("a color that isn't one", client.post("/api/current/layer", json={"id": "Black", "color": "red"}).status_code, 400)

    print(f"\n{'all good' if not failures else f'{len(failures)} failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
