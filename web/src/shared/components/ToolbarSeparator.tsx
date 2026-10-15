import styles from "./ToolbarSeparator.module.css";

/**
 * Shared: a short rule between groups of toolbars - across a column of them ("horizontal"), or
 * upright between toolbars in a row ("vertical"). An app whose column turns into a row at narrow
 * widths passes a class that stands it on end there.
 */
export function ToolbarSeparator({ orientation = "horizontal", className }: { orientation?: "horizontal" | "vertical"; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-orientation={orientation}
      className={className ? `${styles.separator} ${className}` : styles.separator}
    />
  );
}
