#!/usr/bin/env python3
"""
A drawing dragged in from the computer goes on the paper already in use, at full size. Its own page,
or a paper saved with it, never changes the paper - in Plot, Studio or Image, which all take the paper
from the drawing's block.

Runs on its own, against a temporary folder:   python3 tests/dropping_keeps_the_paper.py
"""

import io
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


def drawing(mark, width, height, plot=None):
    block = (f'<metadata id="nextdraw-plot"><nds:plot>{json.dumps(plot)}</nds:plot></metadata>' if plot else "")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:nds="https://github.com/tomcog/NextDraw" '
        f'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="{width}in" height="{height}in" '
        f'viewBox="0 0 {width} {height}">{block}<g id="layer1" inkscape:label="Black" inkscape:groupmode="layer">'
        f'<path id="{mark}" d="M 1 1 L 2 2" stroke="#000"/></g></svg>'
    )


def block_of(svg):
    from lxml import etree
    return server.read_plot(etree.fromstring(svg.encode("utf-8"))) or {}


def drop(client, name, svg):
    return client.post("/api/upload", data={"file": (io.BytesIO(svg.encode("utf-8")), name)},
                       content_type="multipart/form-data")


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
    server.shared_settings = {"settings": None, "preset": None, "version": None}
    client = server.app.test_client()

    letter = {"paper_size": "letter", "paper_w": 279.4, "paper_h": 215.9, "paper_x": 5, "paper_y": 7, "paper_color": "#f0e0d0"}
    file = folder / "open.svg"
    file.write_text(drawing("open", 11, 8.5, {"placement": {"x": 12, "y": 3}, "paper": letter}))
    client.post("/api/open?svg=1", json={"path": str(file)})

    print("a plain drawing on a page of its own size is dropped")
    res = drop(client, "big.svg", drawing("big", 24, 18))
    check("it's taken", res.status_code, 200)
    now = client.get("/api/current").get_json()["svg"]
    check("it's the current drawing", 'id="big"' in now, True)
    check("on the paper that was in use", block_of(now).get("paper"), letter)
    check("where the drawing before it sat", block_of(now).get("placement"), {"x": 12, "y": 3})
    check("Plot is handed that paper", res.get_json()["plot"]["paper"], letter)
    check("at full size: its own units are untouched", 'viewBox="0 0 24 18"' in now and 'd="M 1 1 L 2 2"' in now, True)

    print("\na drawing saved on another paper is dropped")
    a3 = {"paper_size": "a3", "paper_w": 420, "paper_h": 297, "paper_color": "#000000"}
    res = drop(client, "saved.svg", drawing("saved", 16.5, 11.7, {"placement": {"x": 0, "y": 0}, "paper": a3, "tool": "Fine"}))
    now = client.get("/api/current").get_json()["svg"]
    check("it still goes on the paper in use", block_of(now).get("paper"), letter)
    check("keeping the rest of what it was saved with", block_of(now).get("tool"), "Fine")

    print("\nthe drawing in use has no paper in its block")
    client.delete("/api/current")
    server.CURRENT_SVG.write_text(drawing("plain", 9, 12))
    drop(client, "next.svg", drawing("next", 24, 18))
    paper = block_of(client.get("/api/current").get_json()["svg"]).get("paper") or {}
    check("its page is the paper", (paper.get("paper_w"), paper.get("paper_h")), (228.6, 304.8))

    print(f"\n{'all good' if not failures else f'{len(failures)} failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
