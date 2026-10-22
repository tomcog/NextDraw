import styles from "./TrimGuide.module.css";

/**
 * The trim marks' trim as a dashed outline: where the print is cut. On screen only - it's never part
 * of the drawing - in Image, Studio and Plot alike. `box` is in whatever units the caller draws in.
 */
export function TrimGuide({ box, transform }: { box: { x0: number; y0: number; x1: number; y1: number }; transform?: string }) {
  return <rect className={styles.guide} transform={transform} x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />;
}
