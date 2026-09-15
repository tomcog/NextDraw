import styles from "./PlotProgress.module.css";
import { fmtDuration } from "../lib/format";
import type { Status } from "../lib/types";

function progressDetail(s: Status, pct: number) {
  switch (s.state) {
    case "preparing": return "Getting ready…";
    case "stopping": return "Stopping and raising the pen…";
    case "returning": return "Returning home…";
    case "finished": return `Finished in ${fmtDuration(s.elapsed_s)}`;
    case "stopped":
    case "error": return `Stopped after ${fmtDuration(s.elapsed_s)}`;
    default: {
      const left = s.estimate_s && pct > 0 ? Math.max(0, s.estimate_s - s.elapsed_s) : s.estimate_s;
      return `${fmtDuration(s.elapsed_s)} elapsed, about ${fmtDuration(left)} left`;
    }
  }
}

// Progress of the current or last plot, shown above the controls panel. It always takes up its space,
// showing an empty bar when there's nothing to report, so the page doesn't shift when a plot starts.
export function PlotProgress({ status: s }: { status: Status | null }) {
  const hasData = Boolean(s && (["preparing", "plotting", "stopping", "returning"].includes(s.state)
    || (["finished", "stopped", "error"].includes(s.state) && s.started)));
  // After a reload or restart the live status is gone, but a saved stopped plot still has a point.
  const savedStop = !hasData && s?.resume ? s.resume : null;
  const pct = hasData && s?.total_mm
    ? Math.min(100, (s.done_mm / s.total_mm) * 100)
    : savedStop?.total_mm ? Math.min(100, (savedStop.done_mm / savedStop.total_mm) * 100) : 0;
  const shown = hasData && s?.state === "finished" ? 100 : Math.floor(pct);
  const state = hasData ? s!.state : savedStop ? "stopped" : "empty";
  const detail = hasData ? progressDetail(s!, pct) : savedStop ? "Stopped. Resume to continue." : "\u00a0";

  return (
    <div className={styles.progress} data-state={state}>
      <p className={styles.line}>
        <span className={styles.pct}>{pct > 0 && shown < 1 ? "<1%" : `${shown}%`}</span>
        <span>{detail}</span>
      </p>
      <div className={styles.rail} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
        <div className={styles.fill} style={{ width: `${shown === 100 ? 100 : pct}%` }} />
      </div>
    </div>
  );
}
