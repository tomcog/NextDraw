#!/usr/bin/env python3
"""
Plot's hatch fills are Studio's hatch fills.

Plot regenerates a Studio fill when it plots it at a different spacing or scale (regenerate_hatches in
server.py), so the server carries a Python port of Studio's hatch geometry (web/src/studio/lib/hatch.ts).
Two copies of the same geometry drift apart quietly: the preview and the paper would stop matching
what Studio shows, a fraction of a millimetre at a time. This runs both on the same shapes - rectangles
and ellipses, at several angles and spacings, with and without the ends connected - and fails on any
point that differs.

Run it from the repository:   python3 tests/hatch_matches_studio.py
It needs the web dependencies installed (it bundles hatch.ts with esbuild) and nothing else: no server,
no plotter.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402

# A curve is filled against its own outline rather than its box, so the shapes here carry the curve
# that makes them: Studio generates the outline from it, and Plot reads the same outline out of the
# polyline in the file.
# Every kind of fill, since each one is written twice over - once in Studio, once here.
KINDS = ("hatch", "concentric", "wavy", "dashes")

CASES = [
    {"kind": kind, "box": box, "angle": angle, "spacing_mm": spacing, "curve": curve, "fill_kind": fill_kind}
    for kind, box, curve in (
        ("rect", (1, 1, 3.35, 3.36), None),
        ("rect", (0.5, 2, 4.5, 2.8), None),
        ("ellipse", (1, 1, 4, 2.5), None),
        ("ellipse", (2, 2, 3, 3), None),
        ("polygon", (1, 1, 4, 4), {"kind": "star", "points": 5, "inner": 40}),
        ("polygon", (0.5, 1, 4.5, 3), {"kind": "star", "points": 7, "inner": 60}),
        ("polygon", (1, 1, 3.5, 3.5), {"kind": "polygon", "sides": 6}),
        ("polygon", (1, 1, 4, 3), {"kind": "hypotrochoid", "R": 5, "r": 3, "d": 5, "turns": 3}),
    )
    for angle in (0, 30, 45, 90, 100, 135)
    for spacing in (0.3, 1.5, 2.0)
    for fill_kind in KINDS
]

SCRIPT = """
import { fillRuns } from "%s";
import { curveStrokes } from "%s";
const cases = %s;
const out = cases.map((c) => {
  const [x0, y0, x1, y1] = c.box;
  const shape = { id: "s", kind: c.curve ? "curve" : c.kind, x: x0, y: y0, x2: x1, y2: y1, layerId: "", ...(c.curve ? { curve: c.curve } : {}) };
  const fill = { id: "f", shapeId: "s", angle: c.angle, spacingMm: c.spacing_mm, scale: 100, connected: true, kind: c.fill_kind };
  return {
    runs: fillRuns(shape, fill).map((run) => run.map((p) => [p.x, p.y])),
    // The outline Plot reads out of the file, so both sides hatch the same points.
    outline: c.curve ? (curveStrokes(shape)[0] ?? []).map((p) => [p.x, p.y]) : [],
  };
});
console.log(JSON.stringify(out));
"""


def studio():
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "run.ts"
        lib = ROOT / "web" / "src" / "studio" / "lib"
        src.write_text(SCRIPT % (lib / "hatch.ts", lib / "parametric.ts", json.dumps(CASES)))
        out = Path(tmp) / "run.js"
        subprocess.run([str(esbuild), str(src), "--bundle", "--platform=node", "--log-level=error", f"--outfile={out}"], check=True)
        return json.loads(subprocess.run(["node", str(out)], check=True, capture_output=True, text=True).stdout)


def main():
    failures = 0
    for case, ts in zip(CASES, studio()):
        outline = [tuple(p) for p in ts["outline"]]
        fill = {"kind": case["fill_kind"], "angle": case["angle"], "scale": 100, "connected": True}
        runs = server.fill_runs(case["kind"], case["box"], fill, case["spacing_mm"] / 25.4, outline)
        py = [[list(p) for p in run] for run in runs]
        js = ts["runs"]
        same = len(py) == len(js) and all(
            len(a) == len(b) and all(abs(u - v) < 1e-9 for p, q in zip(a, b) for u, v in zip(p, q))
            for a, b in zip(py, js))
        if not same:
            failures += 1
            print(f"DIFFERS  {case}  (python {len(py)} runs, studio {len(js)})")
    print(f"{len(CASES)} fills compared, {failures} differences")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
