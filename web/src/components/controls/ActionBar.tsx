import { Button } from "@tomcoggia/ui";
import styles from "./controls.module.css";
import type { Confirmation, Message } from "../../lib/types";

interface Props {
  message: Message | null;
  plotting: boolean;
  stopping: boolean;
  preparing: boolean;
  canPlot: boolean;
  resume: { done_mm: number; total_mm: number } | null; // a stopped plot that can be resumed
  confirmation: Confirmation | null;
  onCancelConfirmation: () => void;
  onPlot: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onStop: () => void;
}

// The status line under the button is hidden for now.
const SHOW_STATUS = false;

// Above the controls panel: Plot / Stop, or Resume after a stopped plot. The plotter's own messages
// are in the caution callout in the File card (DrawingNotes).
export function ActionBar({ message, plotting, stopping, preparing, canPlot, resume, confirmation, onCancelConfirmation, onPlot, onResume, onDiscard, onStop }: Props) {
  const resumePct = resume && resume.total_mm ? Math.floor((resume.done_mm / resume.total_mm) * 100) : 0;
  return (
    <div className={styles.actions}>
      {confirmation && !plotting ? (
        <div className={styles.confirm} role="alertdialog" aria-label={confirmation.message}>
          <p className={styles.confirmText}>{confirmation.message}</p>
          <div className={styles.resumeRow}>
            <Button size="lg" variant="ghost" onClick={onCancelConfirmation}>Cancel</Button>
            <Button size="lg" variant="primary" tone={confirmation.danger ? "danger" : "primary"} autoFocus onClick={confirmation.onConfirm}>
              {confirmation.confirmLabel}
            </Button>
          </div>
        </div>
      ) : plotting ? (
        <Button size="lg" variant="primary" tone="danger" className={styles.wide} disabled={stopping} loading={preparing} onClick={onStop}>
          Stop
        </Button>
      ) : resume ? (
        <div className={styles.resumeRow}>
          <Button size="lg" variant="ghost" tone="danger" onClick={onDiscard} title="Forget the stopped plot and send the carriage home">
            Discard
          </Button>
          <Button size="lg" variant="primary" onClick={onResume} title={resumePct >= 1 ? `Continue from ${resumePct}%` : "Continue from where it stopped"}>
            Resume
          </Button>
        </div>
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
