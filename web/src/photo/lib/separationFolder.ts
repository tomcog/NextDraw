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
import { api, postJSON } from "../../shared/lib/api";
import type { PenColor } from "../../shared/lib/types";

/**
 * Where a picture came from, for one opened from NextDraw's own file browser: the browser's file
 * has no path of its own, so it's kept beside it, and the photo made from it remembers it for Reload.
 */
export const pictureSources = new WeakMap<File, string>();
/** And which channel of it, for a channel of a Multichannel Photoshop file. */
export const pictureChannels = new WeakMap<File, number>();

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

/** A Photoshop file: one in Multichannel mode is already separations, a channel per ink. */
export const isPhotoshop = (name: string) => /\.ps[db]$/i.test(name);

/**
 * A Multichannel Photoshop file's channels as separations: a grayscale PNG each, named "<file>_<channel>"
 * so they read as the file's, each ink from its channel's name as a separation file's would be
 * (Cyan, Orange...) or else the color Photoshop keeps for it. Null when the file isn't Multichannel -
 * an RGB or CMYK one - and opens as a picture. The server reads it: macOS's converter can't. Sent
 * as the file, or read by its path from one of the server's folders.
 */
export async function channelsOf(source: File | { name: string; path: string }, pens: PenColor[]): Promise<{ files: File[]; found: Inks; name: string } | null> {
  type Sent = { channels: { name: string; color: string | null; png: string }[] | null };
  let channels: Sent["channels"];
  try {
    ({ channels } = await (source instanceof File
      ? api<Sent>("/api/image-channels", { method: "POST", body: source })
      : api<Sent>(`/api/image-channels?path=${encodeURIComponent(source.path)}`)));
  } catch (err) {
    // A server from before it read these says nothing of its own: the file opens as any picture would.
    if ((err as { body?: { error?: string } }).body?.error) throw err;
    return null;
  }
  if (!channels) return null;
  const name = source.name.replace(/\.[^.]+$/, "");
  const inks = new Map<File, FileInk>();
  const unknown: string[] = [];
  const files = channels.map((ch, i) => {
    const bytes = Uint8Array.from(atob(ch.png), (c) => c.charCodeAt(0));
    const file = new File([bytes], `${name}_${ch.name}.png`, { type: "image/png" });
    // Opened from NextDraw's file browser, its place is known: each channel can be reloaded from it.
    if (!(source instanceof File)) {
      pictureSources.set(file, source.path);
      pictureChannels.set(file, i);
    }
    const ink = inkNamed(ch.name, pens) ?? (ch.color ? { color: { name: ch.name, color: ch.color } } : undefined);
    if (ink) inks.set(file, ink);
    else unknown.push(file.name);
    return file;
  });
  return { files, found: { inks, unknown, why: unknown.length ? "Photoshop gave no color for it" : undefined }, name };
}
