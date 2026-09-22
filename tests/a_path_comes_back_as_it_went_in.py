#!/usr/bin/env python3
"""
A path that comes into Studio goes back out as it came: point for point, curve for curve.

Studio used to walk every curve out into points on the way in - a cubic became a dozen short lines -
and wrote those points back out. What a drawing program had said exactly, with two handles, went
out as an approximation of itself, and every edit after that was an edit of the approximation.

Now a path is kept as nodes: each a point, with the handles that bend the way in and out of it where
the path curves there. A `C` in the file is the same `C` in the model and the same `C` written back,
to the same numbers. This is the promise, checked the only way it can be: read every path in every
drawing here, write it out, read it again, and compare every node and every handle. What is drawn
is compared too - the curves walked out to points both times - so the promise holds for the pen as
well as for the file.

Quadratics are lifted to the cubic they exactly are, so they hold as well. Arcs are the one thing
walked out rather than kept, since no single cubic is an arc; a drawing with arcs still comes back
as it was drawn, only in more words.

Run it from the repository:   python3 tests/a_path_comes_back_as_it_went_in.py
It needs the web dependencies installed (it bundles path.ts with esbuild) and nothing else.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The repository's own samples, and the shared drawings when this Mac has them: the big one is the
# case that matters - eighteen thousand cubics of hatching.
FOLDERS = [ROOT / "samples",
           Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs" / "NextDraw Studio" / "Drawings"]

SCRIPT = """
import { parsePath, pathData, flattenRun } from "%s";
const fs = require("fs");
const files = %s;
const near = (a, b) => Math.abs(a - b) <= 1e-6;
const samePoint = (a, b) => !!a === !!b && (!a || (near(a.x, b.x) && near(a.y, b.y)));
const out = [];
for (const file of files) {
  const svg = fs.readFileSync(file, "utf8");
  const ds = [...svg.matchAll(/\\sd="([^"]+)"/g)].map((m) => m[1]);
  let paths = 0, curves = 0, nodes = 0, broken = [];
  for (const d of ds) {
    const a = parsePath(d);
    const b = parsePath(pathData(a));
    paths++;
    let ok = a.length === b.length;
    for (let r = 0; ok && r < a.length; r++) {
      ok = a[r].length === b[r].length;
      for (let i = 0; ok && i < a[r].length; i++) {
        const n = a[r][i], m = b[r][i];
        nodes++;
        if (n.in || n.out) curves++;
        ok = samePoint(n, m) && samePoint(n.in, m.in) && samePoint(n.out, m.out);
      }
      if (ok) {
        const fa = flattenRun(a[r]), fb = flattenRun(b[r]);
        ok = fa.length === fb.length && fa.every((p, i) => samePoint(p, fb[i]));
      }
    }
    if (!ok && broken.length < 3) broken.push(d.slice(0, 80));
  }
  out.push({ file, paths, curves, nodes, broken });
}
console.log(JSON.stringify(out));
"""


def main():
    files = sorted(str(p) for folder in FOLDERS if folder.is_dir() for p in folder.glob("*.svg"))
    if not files:
        print("No drawings to check.")
        sys.exit(1)
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "run.ts"
        src.write_text(SCRIPT % (ROOT / "web" / "src" / "studio" / "lib" / "path.ts", json.dumps(files)))
        out = Path(tmp) / "run.js"
        subprocess.run([str(esbuild), str(src), "--bundle", "--platform=node", "--log-level=error", f"--outfile={out}"], check=True)
        results = json.loads(subprocess.run(["node", str(out)], check=True, capture_output=True, text=True).stdout)

    failures = 0
    total = {"paths": 0, "curves": 0, "nodes": 0}
    for r in results:
        for k in total:
            total[k] += r[k]
        if r["broken"]:
            failures += 1
            print(f"DIFFERS  {Path(r['file']).name}")
            for d in r["broken"]:
                print(f"           {d}…")
    print(f"{len(results)} drawings, {total['paths']} paths, {total['nodes']} nodes, {total['curves']} of them curved: "
          f"{'all came back as they went in' if not failures else f'{failures} drawings did not'}.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
