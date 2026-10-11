// A snapshot: the drawing as it stands, its image layers turned into the lines they draw now, so the
// file opens in Studio as plain paths - simplified, cropped, added to - and in Plot as the lines to
// plot. The drawing it's taken from is left as it was, its images still to be worked on in Image.

import { parsePath, type Node } from "./path";
import { photoMarksNow, photoOrigin } from "./photo";
import { boxOf, pointsBox, type Shape } from "./shapes";

/** The shapes with every image layer swapped for a path of its lines, in the same place and layer. */
export function snapshotShapes(shapes: Shape[]): Shape[] {
  return shapes.flatMap((s) => {
    if (s.kind !== "photo" || !s.photo) return [s];
    const b = boxOf(s);
    const marks = photoMarksNow(s.photo, b.x1 - b.x0, b.y1 - b.y0);
    const at = photoOrigin(s.photo, b.x0, b.y0);
    const runs: Node[][] = (marks?.passes ?? [])
      .filter(Boolean)
      .flatMap((d) => parsePath(d))
      .map((run) => run.map((n) => ({
        x: n.x + at.x,
        y: n.y + at.y,
        ...(n.in ? { in: { x: n.in.x + at.x, y: n.in.y + at.y } } : {}),
        ...(n.out ? { out: { x: n.out.x + at.x, y: n.out.y + at.y } } : {}),
      })))
      .filter((run) => run.length > 1);
    if (!runs.length) return [];
    const box = pointsBox(runs.flat());
    const path: Shape = {
      id: s.id,
      kind: "path",
      layerId: s.layerId,
      ...(s.name ? { name: s.name } : {}),
      ...(runs.length > 1 ? { runs } : { points: runs[0] }),
      x: box.x0,
      y: box.y0,
      x2: box.x1,
      y2: box.y1,
    };
    return [path];
  });
}

/** What a snapshot of a drawing is called: its name, the word, and when, to the minute. */
export function snapshotName(name: string, when = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}.${pad(when.getMinutes())}`;
  return `${name || "Untitled"} snapshot ${stamp}`;
}
