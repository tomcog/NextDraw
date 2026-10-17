import { useCallback, useEffect, useRef } from "react";
import { api, postJSON } from "./api";
import type { Preset } from "./types";

/**
 * The pen every app is using: Plot's chosen tool, which the server holds for every open page. Studio
 * and Image follow it - read again every few seconds, taken when it changes - and a pen picked in
 * either is sent there with its settings, so Plot takes up the tool and its heights and speeds as it
 * takes up a change from another Plot page. Nothing moves on the plotter: only a pen picked in Plot
 * itself sends the clip to the setup height. Returns what to call when a pen is picked by hand.
 */
export function useSharedPen(presets: Preset[], onPen: (name: string) => void) {
  // The shared pen last taken or sent, so each change is taken once.
  const seen = useRef<string | null>(null);
  const onPenRef = useRef(onPen);
  onPenRef.current = onPen;
  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  const read = useCallback(() => api<{ preset: string | null }>("/api/plot-settings")
    .then(({ preset }) => {
      // A pen this page doesn't list yet (presets still loading, or another plotter's) is tried again
      // on the next read rather than counted as taken.
      if (!preset || preset === seen.current || !presetsRef.current.some((p) => p.name === preset)) return;
      seen.current = preset;
      onPenRef.current(preset);
    })
    .catch(() => {}), []); // the next read tries again

  useEffect(() => {
    void read();
    const timer = window.setInterval(read, 3000);
    return () => window.clearInterval(timer);
  }, [read]);
  // The list arriving can make a shared pen takeable that wasn't.
  useEffect(() => void read(), [presets, read]);

  return useCallback((name: string) => {
    seen.current = name;
    const preset = presetsRef.current.find((p) => p.name === name);
    postJSON("/api/plot-settings", { changes: preset?.settings ?? {}, preset: name }, "PUT").catch(() => {});
  }, []);
}
