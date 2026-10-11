// A folder of separations, as the browser hands it over: every file in it, and in any folders inside.
// The separations are the images in the folder itself whose names say their ink; the rest - the
// colour original kept beside them, a contact sheet, a folder of old versions - are left out and
// named, so it's plain what was used. A folder whose images name no ink at all is taken whole, as
// opening its images together would be: four of them are C, M, Y and K in order.
//
// An ink is read from the name here first (inkNamed: plates, the pen's colors, a few hundred color
// names). A name it doesn't know is asked of Claude by the server, when that Mac has a key - "Peach"
// comes back peach - and the layer is drawn in that color, before any pen is chosen for it.

import { inkNamed } from "../../shared/lib/drawing/photo";
import { postJSON } from "../../shared/lib/api";
import type { PenColor } from "../../shared/lib/types";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|tiff?|heic)$/i;

export type FileInk = NonNullable<ReturnType<typeof inkNamed<PenColor>>>;

/** What reading the inks found: each file's ink, and the files no ink was found for, with why Claude wasn't asked or couldn't say. */
export interface Inks {
  inks: Map<File, FileInk>;
  unknown: string[];
  /** Why names weren't asked of Claude: no key on this Mac, no connection, and so on. */
  why?: string;
}

const title = (name: string) => name.replace(/\b\w/g, (c) => c.toUpperCase());

/** Each file's ink: from its name, or failing that from Claude. */
export async function inksOf(files: File[], pens: PenColor[]): Promise<Inks> {
  const inks = new Map<File, FileInk>();
  for (const f of files) {
    const ink = inkNamed(f.name, pens);
    if (ink) inks.set(f, ink.color ? { color: { ...ink.color, name: title(ink.color.name) } } : ink);
  }
  const ask = files.filter((f) => !inks.has(f));
  if (!ask.length) return { inks, unknown: [] };
  try {
    const { results } = await postJSON<{ results: ({ ink: string; hex: string } | null)[] }>(
      "/api/color-names",
      { names: ask.map((f) => f.name) },
    );
    ask.forEach((f, i) => {
      const r = results[i];
      if (r) inks.set(f, { color: { name: r.ink, color: r.hex } });
    });
    return { inks, unknown: ask.filter((f) => !inks.has(f)).map((f) => f.name) };
  } catch (err) {
    const why = (err as Error).message;
    return {
      inks,
      unknown: ask.map((f) => f.name),
      why: why === "no-key" ? "no Anthropic API key on this Mac, so Claude wasn't asked"
        : why === "bad-key" ? "the Anthropic API key on this Mac was refused"
        : why === "offline" ? "Claude couldn't be reached"
        : why === "no-library" ? "the server is missing its Anthropic library: run start.command again"
        : `Claude couldn't say (${why})`,
    };
  }
}

export async function separationFiles(files: File[], pens: PenColor[]): Promise<{ use: File[]; skipped: string[] } & Inks> {
  const images = files
    // The folder's own files: a path "folder/name.png", not "folder/inner/name.png".
    .filter((f) => (f.webkitRelativePath || f.name).split("/").length <= 2)
    .filter((f) => !f.name.startsWith(".") && (f.type.startsWith("image/") || IMAGE.test(f.name)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const found = await inksOf(images, pens);
  const named = images.filter((f) => found.inks.has(f));
  const use = named.length ? named : images;
  return { ...found, use, skipped: images.filter((f) => !use.includes(f)).map((f) => f.name) };
}

/** The folder a file was picked from, when it came in a folder: what a drawing of its separations is named, if their names say nothing else. */
export const folderOf = (file: File) => {
  const parts = (file.webkitRelativePath || "").split("/");
  return parts.length > 1 ? parts[parts.length - 2] : "";
};
