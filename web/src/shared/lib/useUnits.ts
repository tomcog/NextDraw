import { useCallback, useEffect, useState } from "react";
import { api, postJSON } from "./api";
import type { Units } from "./types";

/**
 * Inches or millimetres, as the Paper card names its sizes: one choice for all three apps, kept with
 * Plot's shared settings on the server. Read when the page opens - going to another app opens it
 * again - and sent the moment it's changed, so every app names sizes alike.
 */
export function useUnits(): [Units, (units: Units) => void] {
  const [units, setUnits] = useState<Units>("in");
  useEffect(() => {
    api<{ settings?: { units?: unknown } | null }>("/api/plot-settings")
      .then((shared) => {
        const chosen = shared.settings?.units;
        if (chosen === "in" || chosen === "mm") setUnits(chosen);
      })
      .catch(() => { /* the server away: inches, as before */ });
  }, []);
  const choose = useCallback((next: Units) => {
    setUnits(next);
    postJSON("/api/plot-settings", { changes: { units: next } }, "PUT").catch(() => { /* kept here for now */ });
  }, []);
  return [units, choose];
}
