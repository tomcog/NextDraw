import { Button, ButtonRound } from "@tomcoggia/ui";
import { Minus, Plus } from "lucide-react";
import styles from "../../../shared/components/controls/controls.module.css";
import type { Confirmation, Message } from "../../../shared/lib/types";

interface Props {
  message: Message | null;
  plotting: boolean;
  stopping: boolean;
  preparing: boolean;
  canPlot: boolean;
  plotLabel: string; // e.g. "Plot", or "Plot Red" when one layer of the drawing is chosen
  resume: { done_mm: number; total_mm: number } | null; // a stopped plot that can be resumed
  confirmation: Confirmation | null;
  onCancelConfirmation: () => void;
  onPlot: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onStop: () => void;
  speedPct: number | null; // the plot's speed while plotting or stopped, or null to hide the control
  onSpeed: (percent: number) => void;
}

// The status line under the button is hidden for now.
const SHOW_STATUS = false;

export const SPEED_STEP = 10;
export const SPEED_MIN = 20;
export const SPEED_MAX = 200;

// Speeds the running (or stopped) plot up or down, from the next path it draws.
function SpeedControl({ pct, disabled, onSpeed }: { pct: number; disabled: boolean; onSpeed: (percent: number) => void }) {
  return (
    <div className={styles.speedRow} role="group" aria-label="Plot speed">
      <span className={styles.speedLabel}>Speed</span>
      <ButtonRound size="sm" variant="ghost" icon={<Minus />} aria-label="Slower" title="Slower, from the next line drawn"
        disabled={disabled || pct <= SPEED_MIN} onClick={() => onSpeed(Math.max(SPEED_MIN, pct - SPEED_STEP))} />
      <span className={styles.speedValue} aria-live="polite">{pct}%</span>
      <ButtonRound size="sm" variant="ghost" icon={<Plus />} aria-label="Faster" title="Faster, from the next line drawn"
        disabled={disabled || pct >= SPEED_MAX} onClick={() => onSpeed(Math.min(SPEED_MAX, pct + SPEED_STEP))} />
    </div>
  );
}

// Above the controls panel: Plot / Stop, or Resume after a stopped plot. The plotter's own messages
// are in the caution callout in the File card (DrawingNotes).
export function ActionBar({ message, plotting, stopping, preparing, canPlot, plotLabel, resume, confirmation, onCancelConfirmation, onPlot, onResume, onDiscard, onStop, speedPct, onSpeed }: Props) {
  const resumePct = resume && resume.total_mm ? Math.floor((resume.done_mm / resume.total_mm) * 100) : 0;
  return (
    <div className={styles.actions}>
      {confirmation && !plotting ? (
        <div className={styles.confirm} role="alertdialog" aria-label={confirmation.message}>
          <p className={styles.confirmText}>{confirmation.message}</p>
          <div className={styles.resumeRow}>
            <Button size="lg" variant="ghost" onClick={onCancelConfirmation}>Cancel</Button>
            {confirmation.extraLabel && (
              <Button size="lg" variant="secondary" onClick={confirmation.onExtra}>{confirmation.extraLabel}</Button>
            )}
            <Button size="lg" variant="primary" tone={confirmation.danger ? "danger" : "primary"} autoFocus onClick={confirmation.onConfirm}>
              {confirmation.confirmLabel}
            </Button>
          </div>
        </div>
      ) : plotting ? (
        <>
          <Button size="lg" variant="primary" tone="danger" className={styles.wide} disabled={stopping} loading={preparing} onClick={onStop}>
            Stop
          </Button>
          {speedPct !== null && <SpeedControl pct={speedPct} disabled={stopping} onSpeed={onSpeed} />}
        </>
      ) : resume ? (
        <>
          <div className={styles.resumeRow}>
            <Button size="lg" variant="ghost" tone="danger" onClick={onDiscard} title="Forget the stopped plot and send the carriage home">
              Discard
            </Button>
            <Button size="lg" variant="primary" onClick={onResume} title={resumePct >= 1 ? `Continue from ${resumePct}%` : "Continue from where it stopped"}>
              Resume
            </Button>
          </div>
          {speedPct !== null && <SpeedControl pct={speedPct} disabled={false} onSpeed={onSpeed} />}
        </>
      ) : (
        <Button size="lg" variant="primary" className={styles.wide} disabled={!canPlot} onClick={onPlot}>
          {plotLabel}
        </Button>
      )}
      {SHOW_STATUS && (
        <p className={styles.status} role="status" aria-live="polite" data-tone={message?.tone}>{message?.text}</p>
      )}
    </div>
  );
}
