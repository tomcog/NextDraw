// The paper and everything on it a quarter turn, as a sheet is turned by hand: what the Paper card's
// turn does in Studio and Image (Plot asks the server to do the same to the file).

import type { FitAlign } from "../geometry";
import type { Fill } from "./hatch";
import { readTones, turnedCopy, turnedCrop, type Photo } from "./photo";
import { boxOf, type Page, type Shape } from "./shapes";
import { turnWhole } from "./whole";

/** Where a picture fitted against an edge goes on a turn: on a left turn what was against the top is against the left. */
const turnedAlign = (a: FitAlign, dir: 1 | -1) => (dir < 0 ? { x: a.y, y: 1 - a.x } : { x: 1 - a.y, y: a.x }) as FitAlign;

/**
 * The paper and everything on it a quarter turn, 1 right or -1 left: landscape to portrait. An image
 * layer is drawn from its picture, which a shape's turn doesn't reach, so the picture itself is turned -
 * its crop, its cut and its alignment with it - and its box stands the other way round about its
 * middle. Throws when a picture can't be turned.
 */
export async function turnPaperAndDrawing(shapes: Shape[], fills: Fill[], page: Page, dir: 1 | -1): Promise<{ shapes: Shape[]; fills: Fill[]; page: Page }> {
  const turned = turnWhole(shapes, fills, page, dir);
  // Each picture once: a split's layers share one.
  const pictures = new Map<string, Pick<Photo, "src" | "width" | "height">>();
  for (const sh of shapes) {
    if (sh.photo && !pictures.has(sh.photo.src)) pictures.set(sh.photo.src, await turnedCopy(sh.photo.src, dir));
  }
  await Promise.all([...pictures.values()].map((t) => readTones(t.src)));
  const before = new Map(shapes.map((sh) => [sh.id, sh]));
  const next = turned.shapes.map((sh) => {
    const was = before.get(sh.id);
    if (!sh.photo || !was?.photo) return sh;
    const b = boxOf(sh);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const w = b.y1 - b.y0;
    const h = b.x1 - b.x0;
    return {
      ...sh,
      x: cx - w / 2, y: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2,
      rotation: was.rotation,
      photo: {
        ...sh.photo,
        ...pictures.get(was.photo.src)!,
        crop: turnedCrop(was.photo.crop, dir),
        cut: turnedCrop(was.photo.cut, dir),
        ...(was.photo.align && { align: turnedAlign(was.photo.align, dir) }),
        quarterTurns: (((was.photo.quarterTurns ?? 0) + dir) % 4 + 4) % 4 || undefined,
      },
    };
  });
  return { shapes: next, fills: turned.fills, page: turned.page };
}
