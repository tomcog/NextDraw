import { useCallback, useEffect, useState } from "react";

// Undo keeps whole copies of the drawing rather than a list of changes: a drawing is a handful of
// shapes, so a copy costs nothing, and there's no way for a replayed change to go wrong.

const HISTORY_LIMIT = 60;

/**
 * Undo and redo over snapshots of `current`. `record` is called just before a change, never during
 * one - a drag records once, when it starts; `restore` puts a snapshot back. Cmd-Z and Shift-Cmd-Z
 * undo and redo, except while typing: in a field they belong to the text.
 */
export function useHistory<T>(current: T, restore: (snapshot: T) => void) {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const record = useCallback(() => {
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), current]);
    setFuture([]);
  }, [current]);

  const undo = useCallback(() => {
    if (!past.length) return;
    setPast(past.slice(0, -1));
    setFuture([current, ...future].slice(0, HISTORY_LIMIT));
    restore(past[past.length - 1]);
  }, [past, future, current, restore]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setFuture(future.slice(1));
    setPast([...past, current].slice(-HISTORY_LIMIT));
    restore(future[0]);
  }, [past, future, current, restore]);

  /** Forget everything: a different drawing has nothing to undo back to. */
  const clear = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      (e.shiftKey ? redo : undo)();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return { record, undo, redo, clear, canUndo: past.length > 0, canRedo: future.length > 0 };
}
