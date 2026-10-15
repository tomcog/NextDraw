// Export a photo as a printer profile's inks: a Multichannel Photoshop file, a channel per ink, named
// and colored from the profile - Photoshop's Convert to Profile for the profiles it refuses (seven
// inks, a Riso three). The same split as Image's Profile mode - the same intent, black point
// compensation and Saturate, which decide how a color is shared between the inks - but of the whole
// photo: its original file at full size where Image knows where it is, its working copy otherwise.
// Bright, Contrast and Black are left out: Image applies those to each ink's lines as they're drawn,
// not to the split, and a file for Photoshop is better without them baked in.
import { loadProfile, saturate, type Photo } from "../../shared/lib/drawing/photo";
import { INTENTS, usesBpc } from "../../shared/lib/drawing/icc";
import type { ProfilePsdJob } from "./profilePsd.worker";

/** The photo's pixels at the most there are of them, turned as Image has turned it. */
async function fullPicture(photo: Photo): Promise<{ width: number; height: number; rgba: Uint8ClampedArray; full: boolean }> {
  let blob: Blob | null = null;
  if (photo.source) {
    const res = await fetch(`/api/image-file?path=${encodeURIComponent(photo.source)}`).catch(() => null);
    if (res?.ok) blob = await res.blob();
  }
  const full = Boolean(blob);
  // A channel of a Multichannel file is already one ink: its working copy is all there is to split.
  if (!blob || photo.sourceChannel !== undefined) blob = await (await fetch(photo.src)).blob();
  const bitmap = await createImageBitmap(blob);
  const turns = ((photo.quarterTurns ?? 0) % 4 + 4) % 4;
  const width = turns % 2 ? bitmap.height : bitmap.width;
  const height = turns % 2 ? bitmap.width : bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.translate(width / 2, height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  return { width, height, rgba: ctx.getImageData(0, 0, width, height).data, full: full && photo.sourceChannel === undefined };
}

/** What the file is called: the photo's own name, then the profile's and how it was fitted. */
export function psdName(stem: string, profileName: string, intent: number, bpc: boolean): string {
  const how = `${INTENTS[intent] ?? INTENTS[0]}${bpc && usesBpc(intent) ? ", BPC" : ""}`;
  return `${stem} - ${profileName} (${how}).psd`.replace(/[/\\:]/g, "-");
}

/**
 * Split the photo by its profile and hand the file to the browser to save. Resolves to what was made:
 * its name, its size, and whether it's from the original file or Image's working copy.
 */
export async function exportProfilePsd(photo: Photo, stem: string): Promise<{ name: string; width: number; height: number; full: boolean }> {
  if (!photo.profile) throw new Error("This photo isn't split by a profile");
  const [profile, picture] = await Promise.all([loadProfile(photo.profile), fullPicture(photo)]);
  if (photo.saturation) saturate(picture.rgba, photo.saturation);
  const intent = photo.profileIntent ?? 0;
  const bpc = Boolean(photo.profileBpc);
  const job: ProfilePsdJob = {
    profile,
    rendering: { intent, bpc },
    width: picture.width,
    height: picture.height,
    rgba: picture.rgba,
    names: Array.from({ length: profile.inks }, (_, i) => profile.names?.[i] ?? `Channel ${i + 1}`),
    colors: Array.from({ length: profile.inks }, (_, i) => profile.colors?.[i] ?? "#000000"),
    labs: profile.labs,
  };
  const psd = await new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL("./profilePsd.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ psd?: Uint8Array; error?: string }>) => {
      worker.terminate();
      if (e.data.psd) resolve(e.data.psd);
      else reject(new Error(e.data.error ?? "The file couldn't be made"));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "The file couldn't be made"));
    };
    worker.postMessage(job, [job.rgba.buffer]);
  });
  const name = psdName(stem, photo.profileName ?? photo.profile.replace(/\.ic[cm]$/i, ""), intent, bpc);
  const url = URL.createObjectURL(new Blob([psd as Uint8Array<ArrayBuffer>], { type: "image/vnd.adobe.photoshop" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { name, width: picture.width, height: picture.height, full: picture.full };
}
