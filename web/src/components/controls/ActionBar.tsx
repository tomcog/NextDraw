import { Button } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import type { Message } from "../../lib/types";

interface Props {
  message: Message | null;
  plotting: boolean;
  stopping: boolean;
  preparing: boolean;
  canPlot: boolean;
  onPlot: () => void;
  onStop: () => void;
}

// The status line under the button is hidden for now.
const SHOW_STATUS = false;

// Above the controls panel: Plot / Stop and the status line. The plotter's own messages are in the
// caution callout under the preview (DrawingNotes).
export function ActionBar({ message, plotting, stopping, preparing, canPlot, onPlot, onStop }: Props) {
  return (
    <div className={styles.actions}>
      {plotting ? (
        <Button size="lg" variant="primary" tone="danger" className={styles.wide} disabled={stopping} loading={preparing} onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button size="lg" variant="primary" className={styles.wide} disabled={!canPlot} onClick={onPlot}>
          Plot
        </Button>
      )}
      {SHOW_STATUS && (
        <p className={styles.status} role="status" aria-live="polite" data-tone={message?.tone}>{message?.text}</p>
      )}
    </div>
  );
}
