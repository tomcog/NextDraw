#!/usr/bin/env python3
"""
The file browser lists a folder, and opens only what is inside one it is allowed.

/api/browse is how every app's Open dialog fills itself, and it was the one part of the server with
no test at all - which is how a missing `import os` in places.py shipped and broke Open drawing in
every app, with twenty-one tests passing (Tom, 2026-11-24). The route reads the saved folders, walks
one of them, and refuses a path outside them; this walks that whole path.

Run it from the repository:   python3 tests/the_file_browser_lists_a_folder.py
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

PAGE = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="6in" height="4in" viewBox="0 0 576 384">
  <g><path d="M 10 10 L 560 370" stroke="#231f20" fill="none"/></g>
</svg>
"""

failures = []


def check(what, ok):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


def main():
    folder = Path(tempfile.mkdtemp())
    (folder / "a drawing.svg").write_text(PAGE)
    (folder / "notes.txt").write_text("not a drawing")
    inner = folder / "Inner"
    inner.mkdir()
    (inner / "deeper.svg").write_text(PAGE)
    outside = Path(tempfile.mkdtemp())
    (outside / "elsewhere.svg").write_text(PAGE)

    server.places.allowed_folders = lambda: [folder]
    # /api/open makes a drawing THE drawing, so without this the test replaces whatever the person
    # at this Mac has open - which is exactly what it did, once (Tom, 2026-11-24). Every path the
    # open writes is moved into this test's own folder first.
    jobs = Path(tempfile.mkdtemp())  # beside the browsed folder, not in it: this one gets listed
    server.places.JOBS = jobs
    for name, file in (("CURRENT_SVG", "current.svg"), ("CURRENT_MTIME", "current.mtime"),
                       ("CURRENT_OPENED", "current.opened"), ("CURRENT_HASH", "current.hash"),
                       ("CURRENT_PATH", "current.path"), ("CURRENT_STATE", "current.json"),
                       ("RESUME_SVG", "resume.svg"), ("RESUME_META", "resume.json"),
                       ("PLOT_PATHS", "plot-paths.svg"), ("PRINTED_FILE", "printed-layers.json")):
        setattr(server.places, name, jobs / file)
    client = server.app.test_client()

    listing = client.get("/api/browse").get_json()
    check("a folder lists without being asked for one", listing is not None and "files" in listing)
    names = [f["name"] for f in listing["files"]]
    check("the drawing is listed", "a drawing.svg" in names)
    check("the folder inside it is listed, apart from the files", [f["name"] for f in listing["folders"]] == ["Inner"])
    check("a text file is not", "notes.txt" not in names)
    check("the drawing is named as an SVG", next(f["kind"] for f in listing["files"] if f["name"] == "a drawing.svg") == "svg")

    deeper = client.get(f"/api/browse?path={inner}").get_json()
    check("a folder inside the allowed one lists", [f["name"] for f in deeper["files"]] == ["deeper.svg"])

    refused = client.get(f"/api/browse?path={outside}")
    check("a folder outside every allowed one is refused", refused.status_code == 403)

    opened = client.post("/api/open", json={"path": str(folder / "a drawing.svg")})
    check("a drawing in an allowed folder opens", opened.status_code == 200)
    elsewhere = client.post("/api/open", json={"path": str(outside / "elsewhere.svg")})
    check("one outside it does not", elsewhere.status_code == 403)

    print("\nall passed" if not failures else f"\n{len(failures)} failed")
    sys.exit(1 if failures else 0)


main()
