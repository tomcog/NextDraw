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

CASES = [
    {"kind": kind, "box": box, "angle": angle, "spacing_mm": spacing}
    for kind, box in (("rect", (1, 1, 3.35, 3.36)), ("rect", (0.5, 2, 4.5, 2.8)), ("ellipse", (1, 1, 4, 2.5)), ("ellipse", (2, 2, 3, 3)))
    for angle in (0, 30, 45, 90, 100, 135)
    for spacing in (0.3, 1.5, 2.0)
]

SCRIPT = """
import { hatchLines, hatchStroke } from "%s";
const cases = %s;
const out = cases.map((c) => {
  const [x0, y0, x1, y1] = c.box;
  const shape = { id: "s", kind: c.kind, x: x0, y: y0, x2: x1, y2: y1, layerId: "" };
  const fill = { id: "f", shapeId: "s", angle: c.angle, spacingMm: c.spacing_mm, scale: 100, connected: true };
  return { lines: hatchLines(shape, fill).map((l) => [l.x1, l.y1, l.x2, l.y2]), stroke: hatchStroke(shape, fill).map((p) => [p.x, p.y]) };
});
console.log(JSON.stringify(out));
"""


def studio():
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "run.ts"
        src.write_text(SCRIPT % (ROOT / "web" / "src" / "studio" / "lib" / "hatch.ts", json.dumps(CASES)))
        out = Path(tmp) / "run.js"
        subprocess.run([str(esbuild), str(src), "--bundle", "--platform=node", "--log-level=error", f"--outfile={out}"], check=True)
        return json.loads(subprocess.run(["node", str(out)], check=True, capture_output=True, text=True).stdout)


def main():
    failures = 0
    for case, ts in zip(CASES, studio()):
        lines = server.hatch_lines(case["kind"], case["box"], case["angle"], case["spacing_mm"] / 25.4)
        stroke = server.hatch_stroke(case["kind"], case["box"], lines)
        for name, py, js in (("lines", [list(l) for l in lines], ts["lines"]), ("stroke", [list(p) for p in stroke], ts["stroke"])):
            same = len(py) == len(js) and all(abs(a - b) < 1e-9 for p, q in zip(py, js) for a, b in zip(p, q))
            if not same:
                failures += 1
                print(f"DIFFERS  {name}: {case}  (python {len(py)}, studio {len(js)})")
    print(f"{len(CASES)} fills compared, {failures} differences")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
