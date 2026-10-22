import { useEffect, useRef, useState } from "react";

/** A drawing file, by its name: what a drop opens as a drawing rather than as a picture. */
export const isSvgFile = (file: File) => /\.svg$/i.test(file.name);

/**
 * Files dragged from the computer onto the page, anywhere on it - the canvas is most of it. True while
 * they're over the page, so the app can say where they'll go; onDrop gets them when they're let go.
 * While accepting() says no - the app busy - nothing is highlighted and a drop is let fall, but still
 * caught: never opened by the browser in the app's place.
 */
export function useFileDrop(onDrop: (files: File[]) => void, accepting: () => boolean = () => true) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ onDrop, accepting });
  latest.current = { onDrop, accepting };
  useEffect(() => {
    // dragenter and dragleave fire for every element crossed on the way: counted, so the highlight
    // only goes once the files have left the page.
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || !latest.current.accepting()) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    // Without this, a file let go over the page is opened by the browser in place of the app.
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length && latest.current.accepting()) latest.current.onDrop(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dragging;
}
