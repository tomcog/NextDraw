import { useEffect, useState } from "react";
import { onSeparation, readTones, tonesOf } from "./photo";

/**
 * Whether a photo has been read yet, redrawing whatever asks once it has - and once a separation of
 * it into many plates, worked out off the page, is ready. Reading a photo takes a
 * moment the first time, and anything showing its lines - the page, or the count on its card - has
 * to know to draw again when they can be made.
 */
export function usePhotoRead(src: string | undefined): boolean {
  const [, setRead] = useState(0);
  useEffect(() => {
    if (!src || tonesOf(src)) return;
    let live = true;
    readTones(src).then(() => live && setRead((n) => n + 1)).catch(() => {});
    return () => { live = false; };
  }, [src]);
  // And again when a separation worked out off the page is ready: its plates' lines can be drawn now.
  useEffect(() => onSeparation(() => setRead((n) => n + 1)), []);
  return Boolean(src && tonesOf(src));
}

/**
 * The same for several photos at once - every layer of a photo made of separations, each its own
 * picture - so all their lines are drawn, not just the one picked: after a reload only the picked
 * one's picture would otherwise be read, and the other layers would draw nothing until each was picked.
 */
export function usePhotosRead(srcs: string[]): void {
  const [, setRead] = useState(0);
  const key = [...new Set(srcs)].join("\n");
  useEffect(() => {
    const unread = [...new Set(srcs)].filter((src) => src && !tonesOf(src));
    if (!unread.length) return;
    let live = true;
    Promise.all(unread.map((src) => readTones(src).catch(() => {}))).then(() => live && setRead((n) => n + 1));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
