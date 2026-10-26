import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import styles from "./TrimGuide.module.css";

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The trim marks' trim as a dashed outline: where the print is cut. On screen only - it's never part
 * of the drawing - in Image, Studio and Plot alike. `box` is in whatever units the caller draws in.
 */
export function TrimGuide({ box, transform }: { box: Box; transform?: string }) {
  return <rect className={styles.guide} transform={transform} x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />;
}

/**
 * The trim, picked up anywhere inside it and dragged: what's in it (`children`, the guide and any
 * marks drawn with it) follows the pointer, and `onMove` is told how far it went - in the caller's
 * own units, as `box` is - once, when it's let go, so the move is one undo step.
 */
export function TrimGrab({ box, onMove, children }: { box: Box; onMove: (dx: number, dy: number) => void; children: ReactNode }) {
  const [by, setBy] = useState<{ x: number; y: number } | null>(null);
  const from = useRef<{ id: number; ctm: DOMMatrix; x: number; y: number } | null>(null);
  const at = (e: ReactPointerEvent, ctm: DOMMatrix) => new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
  const down = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // the trim, not the drawing or the page under it
    const ctm = e.currentTarget.getScreenCTM()?.inverse();
    if (!ctm) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e, ctm);
    from.current = { id: e.pointerId, ctm, x: p.x, y: p.y };
    setBy({ x: 0, y: 0 });
  };
  const move = (e: ReactPointerEvent) => {
    const f = from.current;
    if (!f || e.pointerId !== f.id) return;
    const p = at(e, f.ctm);
    setBy({ x: p.x - f.x, y: p.y - f.y });
  };
  const up = (e: ReactPointerEvent) => {
    const f = from.current;
    if (!f || e.pointerId !== f.id) return;
    const p = at(e, f.ctm);
    from.current = null;
    setBy(null);
    if (p.x !== f.x || p.y !== f.y) onMove(p.x - f.x, p.y - f.y);
  };
  return (
    <g transform={by ? `translate(${by.x} ${by.y})` : undefined}>
      {children}
      <rect
        className={styles.grab}
        data-dragging={by ? "true" : undefined}
        x={box.x0}
        y={box.y0}
        width={box.x1 - box.x0}
        height={box.y1 - box.y0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
    </g>
  );
}
