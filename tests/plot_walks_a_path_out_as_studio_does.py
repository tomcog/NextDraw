#!/usr/bin/env python3
"""
Plot walks a curve out to the same points Studio does.

Studio keeps a path's curves as curves and writes them back as curves, and Plot walks them out into
points itself when it needs points - to regenerate a hatch fill on a curved shape at a spacing or
scale other than the one the fill was made for. So the server carries a Python port of Studio's path
reader (flatten_path_data in server.py, from web/src/shared/lib/drawing/path.ts).

Two copies of the same walk drift apart quietly: the outline Plot clips a fill to would stop being
the outline Studio clipped it to, a fraction of a millimetre at a time, and the preview and the paper
would stop matching what Studio shows. This runs both over every path in every drawing it can find
and fails on any point that differs.

Run it from the repository:   python3 tests/plot_walks_a_path_out_as_studio_does.py
It needs the web dependencies installed (it bundles path.ts with esbuild) and nothing else.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402

FOLDERS = [ROOT / "samples",
           Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs" / "NextDraw Studio" / "Drawings"]

# One line of JSON a drawing, written as each is walked: every drawing's points in one string grew past
# the longest string Node will make.
SCRIPT = """
import { flattenPath } from "%s";
const fs = require("fs");
const out = fs.openSync(%s, "w");
for (const file of %s) {
  const svg = fs.readFileSync(file, "utf8");
  const runs = [...svg.matchAll(/\\sd="([^"]+)"/g)].map((m) => flattenPath(m[1], 0.01).map((run) => run.map((p) => [p.x, p.y])));
  fs.writeSync(out, JSON.stringify(runs) + "\\n");
}
fs.closeSync(out);
"""


def compare(file, studio, failed_before):
    """One drawing's paths, walked out here and as Studio walked them: (paths differing, paths, points)."""
    svg = Path(file).read_text(encoding="utf-8", errors="replace")
    failures = paths = points = 0
    for d, theirs in zip(re.findall(r'\sd="([^"]+)"', svg), studio):
        ours = server.flatten_path_data(d, 0.01)
        paths += 1
        same = len(ours) == len(theirs) and all(
            len(a) == len(b) and all(abs(p[0] - q[0]) < 1e-9 and abs(p[1] - q[1]) < 1e-9 for p, q in zip(a, b))
            for a, b in zip(ours, theirs))
        points += sum(len(r) for r in ours)
        if not same:
            failures += 1
            if failed_before + failures <= 5:
                print(f"DIFFERS  {Path(file).name}: {d[:70]}…  (python {sum(len(r) for r in ours)} points, studio {sum(len(r) for r in theirs)})")
    return failures, paths, points


def main():
    files = sorted(str(p) for folder in FOLDERS if folder.is_dir() for p in folder.glob("*.svg"))
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "run.ts"
        walked = Path(tmp) / "studio.jsonl"
        src.write_text(SCRIPT % (ROOT / "web" / "src" / "shared" / "lib" / "drawing" / "path.ts", json.dumps(str(walked)), json.dumps(files)))
        out = Path(tmp) / "run.js"
        subprocess.run([str(esbuild), str(src), "--bundle", "--platform=node", "--log-level=error", f"--outfile={out}"], check=True)
        subprocess.run(["node", str(out)], check=True)

        failures = paths = points = 0
        with walked.open(encoding="utf-8") as studio:
            for file, line in zip(files, studio):
                f, p, n = compare(file, json.loads(line), failures)
                failures, paths, points = failures + f, paths + p, points + n
    print(f"{len(files)} drawings, {paths} paths, {points} points walked out: "
          f"{'Plot and Studio agree on every one' if not failures else f'{failures} paths differ'}.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
