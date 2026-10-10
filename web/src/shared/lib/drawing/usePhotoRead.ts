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
