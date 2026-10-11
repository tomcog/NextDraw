// A folder of separations, as the browser hands it over: every file in it, and in any folders inside.
// The separations are the images in the folder itself whose names say their ink; the rest - the
// colour original kept beside them, a contact sheet, a folder of old versions - are left out and
// named, so it's plain what was used. A folder whose images name no ink at all is taken whole, as
// opening its images together would be: four of them are C, M, Y and K in order.

import { inkNamed } from "../../shared/lib/drawing/photo";
import type { PenColor } from "../../shared/lib/types";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|tiff?|heic)$/i;

export function separationFiles(files: File[], pens: PenColor[]): { use: File[]; skipped: string[] } {
  const images = files
    // The folder's own files: a path "folder/name.png", not "folder/inner/name.png".
    .filter((f) => (f.webkitRelativePath || f.name).split("/").length <= 2)
    .filter((f) => !f.name.startsWith(".") && (f.type.startsWith("image/") || IMAGE.test(f.name)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const named = images.filter((f) => inkNamed(f.name, pens));
  const use = named.length ? named : images;
  return { use, skipped: images.filter((f) => !use.includes(f)).map((f) => f.name) };
}
