#!/usr/bin/env python3
"""
A drawing is within the plotter's reach when its lines are, not its page. In every app the page is
the paper's size, so a drawing on a sheet bigger than the plotter's travel has a page that runs past
the rails even when every line is well within them - and was refused for it.

What has to hold:
- a 36 x 24 in page on a 2234 (34.02 x 23.39 in of travel), its lines inside that, isn't refused;
- the same drawing placed so far from home that its lines would run past the rails still is.

Runs on its own, against a temporary folder:   python3 tests/only_the_lines_must_reach.py
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


BIG_PAGE = (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
    'width="36in" height="24in" viewBox="0 0 36 24">'
    '<g id="layer1" inkscape:label="Black" inkscape:groupmode="layer">'
    '<path d="M 1 1 L 28 1 L 28 20 L 1 20 Z" fill="none" stroke="#000" stroke-width="0.01"/></g></svg>'
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
    file = folder / "big.svg"
    file.write_text(BIG_PAGE)
    client.post("/api/open?svg=1", json={"path": str(file)})

    settings = server.clean_settings({"model": 10})  # the NextDraw 2234
    estimate = server.dry_run(settings, render=False)
    check("the page is wider than the plotter reaches", estimate["doc_in"][0] > 34.02, True)
    at_home = {"x": 0.0, "y": 0.0, "scale": 100}
    check("at home, its lines in reach: not refused", server.placement_problem(settings, at_home, estimate), None)
    far = {"x": 200.0, "y": 0.0, "scale": 100}  # 7.9 in along: the lines' far side at about 35.9 in
    check("placed past the rails: refused", server.placement_problem(settings, far, estimate) is not None, True)

    print("\nall good" if not failures else f"\n{len(failures)} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
