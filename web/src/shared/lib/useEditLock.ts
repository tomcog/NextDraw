import { useEffect, type RefObject } from "react";
import type { BannerMessage } from "../components/StatusBanner";
import type { Lock } from "./drawing/useDrawingFile";

/**
 * Shared by Studio and Image: while Plot is drawing the current drawing, or a stopped plot of it waits
 * to be resumed, the page can be looked at but not changed. The page's main area is made inert - no
 * clicks, no focus, no typing - and the keys the editors listen for on the whole window are held back
 * before they reach them. The browser's own shortcuts are left alone.
 */
export function useEditLock(lock: Lock, main: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = main.current;
    if (!el || !lock) return;
    el.setAttribute("inert", "");
    const hold = (e: KeyboardEvent) => e.stopImmediatePropagation();
    window.addEventListener("keydown", hold, true);
    return () => {
      el.removeAttribute("inert");
      window.removeEventListener("keydown", hold, true);
    };
  }, [lock, main]);
}

/** What the banner says while locked, with the way to Plot, where the lock is ended. */
export function lockBanner(lock: Lock, toPlot: () => void): BannerMessage | null {
  if (!lock) return null;
  return {
    text: lock === "plotting"
      ? "Plot is drawing this. Editing is paused until it has finished, so the drawing stays what’s on the paper."
      : "A stopped plot of this drawing is waiting in Plot. Resume or discard it there to edit again.",
    caution: true,
    id: `lock-${lock}`,
    action: { label: "Go to Plot", onClick: toPlot },
  };
}
