#!/usr/bin/env python3
"""
The Paper card's drawing controls in Plot - Scale, Turn, Fit - change the drawing itself, as they do
in Studio and Image, so every app shows the same.

What has to hold:
- scaling and turning go about the middle of the lines, and leave the file and the paper alone;
- the change is one the editors are told of, and isn't saved;
- fitting puts the lines inside the margin of the paper where Plot has it under the page;
- Plot's old scale and turn are put into the drawing once, and out of its block.

Runs on its own, against a temporary folder:   python3 tests/paper_card_changes_the_drawing.py
"""

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


def near(a, b):
    return all(abs(x - y) < 0.02 for x, y in zip(a, b))


def drawing(block=""):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:nds="https://github.com/tomcog/NextDraw" '
        'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="11in" height="8.5in" viewBox="0 0 11 8.5">'
        f'{block}<g id="layer1" inkscape:label="Black" inkscape:groupmode="layer">'
        '<path d="M 1 1 L 5 1 L 5 3 L 1 3 Z" fill="none" stroke="#000" stroke-width="0.01"/></g></svg>'
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
    file = folder / "box.svg"
    file.write_text(drawing())
    client.post("/api/open?svg=1", json={"path": str(file)})
    box = lambda: server.drawing_bounds(server.clean_settings({}))[:4]  # noqa: E731
    check("the lines start at 1,1 to 5,3", near(box(), (1, 1, 5, 3)), True)

    print("\nscaled to 50%")
    edited = client.get("/api/status").get_json().get("file_edited")
    res = client.post("/api/current/reshape", json={"scale": 50})
    check("it's done", res.status_code, 200)
    check("about the middle of the lines", near(box(), (2, 1.5, 4, 2.5)), True)
    check("the editors are told", client.get("/api/status").get_json().get("file_edited") != edited, True)
    check("as a change not saved", client.get("/api/current").get_json()["dirty"], True)
    check("the file is untouched", file.read_text(), drawing())

    print("\nturned right")
    client.post("/api/current/reshape", json={"scale": 200})
    client.post("/api/current/reshape", json={"turn": 1})
    check("about its middle, standing up now", near(box(), (2, 0, 4, 4)), True)
    check("the page is as it was", client.get("/api/current").get_json()["svg"].count('width="11in"'), 1)

    print("\nfitted to the paper under the page, with a half-inch margin, to the left")
    client.post("/api/current/reshape", json={"turn": -1})
    res = client.post("/api/current/reshape", json={"fit": 12.7, "align": {"x": 0, "y": 0.5}, "box": [0, 0, 11, 8.5]})
    check("as big as fits: 10 across, 5 down", near(box(), (0.5, 1.75, 10.5, 6.75)), True)
    check("and Plot is told the scale", round(res.get_json()["scaled"], 3), 2.5)

    print("\nPlot's own scale and turn, from before")
    file2 = folder / "old.svg"
    file2.write_text(drawing('<metadata id="nextdraw-plot"><nds:plot>{"scale": 50, "rotation": 0}</nds:plot></metadata>'))
    client.post("/api/open?svg=1", json={"path": str(file2)})
    res = client.post("/api/current/reshape", json={"bake": True})
    check("are put into the drawing", res.get_json().get("baked"), True)
    check("scaled from the page's corner", near(box(), (0.5, 0.5, 2.5, 1.5)), True)
    from lxml import etree
    plot = server.read_plot(etree.fromstring(server.CURRENT_SVG.read_bytes())) or {}
    check("and out of its block", (plot.get("scale"), plot.get("rotation")), (100, 0))
    res = client.post("/api/current/reshape", json={"bake": True})
    check("once: asked again, nothing is done", res.get_json().get("baked"), False)
    check("and the drawing is as it was", near(box(), (0.5, 0.5, 2.5, 1.5)), True)

    print("\nturned right with its paper")
    file3 = folder / "sheet.svg"
    file3.write_text(drawing('<metadata id="nextdraw-plot"><nds:plot>{"paper": {"paper_w": 279.4, "paper_h": 215.9}}</nds:plot></metadata>'))
    client.post("/api/open?svg=1", json={"path": str(file3)})
    res = client.post("/api/current/reshape", json={"turn": 1, "paper": True})
    check("it's done", res.status_code, 200)
    root = etree.fromstring(server.CURRENT_SVG.read_bytes())
    check("the page stands up", (root.get("width"), root.get("height"), root.get("viewBox")), ("8.5in", "11in", "0 0 8.5 11"))
    check("the paper in Plot's block too", ((server.read_plot(root) or {}).get("paper") or {}).get("paper_w"), 215.9)
    check("the lines where the sheet took them: top-left goes top right", near(box(), (5.5, 1, 7.5, 5)), True)
    client.post("/api/current/reshape", json={"turn": -1, "paper": True})
    root = etree.fromstring(server.CURRENT_SVG.read_bytes())
    check("and back left, as it was", (root.get("width"), root.get("height"), near(box(), (1, 1, 5, 3))), ("11in", "8.5in", True))

    print(f"\n{'all good' if not failures else f'{len(failures)} failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
