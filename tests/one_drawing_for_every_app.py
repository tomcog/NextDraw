#!/usr/bin/env python3
"""
One drawing at a time, for all three apps: the one Plot has loaded. Studio and Image send their
changes to it, Plot shows them, and only Save writes the file.

What has to hold:
- a change sent to the current drawing doesn't touch its file, and keeps Plot's choices for it;
- Plot's own choices, saved while there are edits not saved, go to the current drawing only;
- saving from an editor writes the file - Plot's choices included - and leaves nothing to save;
- a file changed on disk is not reopened over edits not saved;
- a change to a drawing that has since been replaced by another is refused.

Runs on its own, against a temporary folder:   python3 tests/one_drawing_for_every_app.py
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


def drawing(mark, plot=None):
    block = (f'<metadata id="nextdraw-plot"><nds:plot>{json.dumps(plot)}</nds:plot></metadata>' if plot else "")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:nds="https://github.com/tomcog/NextDraw" '
        'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="11in" height="8.5in" viewBox="0 0 11 8.5">'
        f'{block}<g id="layer1" inkscape:label="Black" inkscape:groupmode="layer">'
        f'<path id="{mark}" d="M 1 1 L 2 2" stroke="#000"/></g></svg>'
    )


def x_of(svg):
    """Where Plot's block says the drawing sits, across."""
    from lxml import etree
    plot = server.read_plot(etree.fromstring(svg.encode("utf-8"))) or {}
    return (plot.get("placement") or {}).get("x")


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

    file = folder / "portrait.svg"
    file.write_text(drawing("original", {"placement": {"x": 0, "y": 0}, "scale": 100, "rotation": 0}))

    print("opening a file makes it the current drawing")
    opened = client.post("/api/open?svg=1", json={"path": str(file)}).get_json()
    check("the editor gets its SVG", 'id="original"' in opened.get("svg", ""), True)
    check("and the file it lives in", opened.get("path"), str(file.resolve()))
    check("with nothing to save", opened.get("dirty"), False)
    base = opened["opened"]

    print("\nPlot moves it, with nothing unsaved: into the file, as before")
    res = client.post("/api/drawing", json={"file": "portrait.svg", "plot": {"placement": {"x": 20, "y": 10}, "scale": 80, "rotation": 0}})
    check("Plot's save went through", res.status_code, 200)
    check("the file has Plot's placement", x_of(file.read_text()) == 20, True)

    print("\nan editor sends a change")
    res = client.post("/api/current", json={"svg": drawing("edited"), "name": "portrait", "base": base, "dirty": True})
    check("it's taken", res.status_code, 200)
    check("the file is untouched", 'id="original"' in file.read_text(), True)
    now = client.get("/api/current").get_json()
    check("the current drawing has the change", 'id="edited"' in now["svg"], True)
    check("and says it isn't saved", now["dirty"], True)
    check("Plot's placement is kept in it", x_of(now["svg"]) == 20, True)
    status = client.get("/api/status").get_json()
    check("Plot is told it changed", bool(status.get("file_edited")), True)
    check("and that it isn't saved", status.get("file_dirty"), True)

    print("\nPlot moves it while it isn't saved")
    res = client.post("/api/drawing", json={"file": "portrait.svg", "plot": {"placement": {"x": 30, "y": 10}, "scale": 80, "rotation": 0}})
    check("Plot's save went through", res.status_code, 200)
    check("the file is still untouched", 'id="original"' in file.read_text() and x_of(file.read_text()) == 20, True)
    check("the current drawing has the new placement", x_of(client.get("/api/current").get_json()["svg"]) == 30, True)

    print("\nthe file changes on disk meanwhile")
    import os
    import time
    os.utime(file, ns=(time.time_ns(), time.time_ns() + 10**9))
    file.write_text(file.read_text() + " ")
    check("Plot isn't told to reopen it over the edits", client.get("/api/status").get_json().get("drawing_stale"), False)

    print("\nthe editor saves")
    res = client.post("/api/studio/save", json={"svg": drawing("edited"), "name": "portrait", "folder": str(folder),
                                                "replace": True, "current": base})
    check("it's saved", res.status_code, 200)
    check("into its own file", res.get_json().get("name"), "portrait.svg")
    text = file.read_text()
    check("the file has the edit", 'id="edited"' in text, True)
    check("and Plot's latest placement", x_of(text) == 30, True)
    now = client.get("/api/current").get_json()
    check("nothing is left to save", now["dirty"], False)
    check("it's the same opening, so Plot keeps its place", now["opened"], base)

    print("\na new drawing from an editor")
    res = client.post("/api/current", json={"svg": drawing("new"), "name": "sunset", "base": None, "dirty": True})
    check("it's taken", res.status_code, 200)
    now = client.get("/api/current").get_json()
    check("it has no file yet", now["path"], None)
    check("it's a new opening", now["opened"] != base, True)
    check("the old file is untouched", 'id="edited"' in file.read_text(), True)

    print("\na change to the drawing that was replaced")
    res = client.post("/api/current", json={"svg": drawing("late"), "name": "portrait", "base": base, "dirty": True})
    check("is refused", res.status_code, 409)
    check("and the new drawing stands", 'id="new"' in client.get("/api/current").get_json()["svg"], True)

    print(f"\n{'all good' if not failures else f'{len(failures)} failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
