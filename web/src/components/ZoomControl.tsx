import { ButtonRound, Segment, SegmentedControl, Spinner } from "@tomcoggia/ui";
import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
import styles from "./Bed.module.css";
import type { Zoom } from "./Bed";

interface Props {
  zoom: Zoom;
  canPaper: boolean;
  canDrawing: boolean;
  onZoom: (zoom: Zoom) => void;
  canRotate: boolean;
  onRotate: (quarterTurns: 1 | -1) => void;
  updating: boolean; // the plot simulation is still working out pen paths and time
}

// Preset zooms for the preview: the plotter's full area, the paper, or the drawing. Floats over the
// bottom right of the preview.
export function ZoomControl({ zoom, canPaper, canDrawing, onZoom, canRotate, onRotate, updating }: Props) {
  return (
    <div className={styles.toolbar}>
      {updating && canDrawing && (
        <span className={styles.updating} role="status">
          <Spinner size={14} label="Updating" />
          Updating plot time…
        </span>
      )}
      {canDrawing && (
        <div className={styles.rotate} role="group" aria-label="Turn the drawing">
          <ButtonRound size="sm" icon={<RotateCcwSquare />} aria-label="Turn the drawing left" title="Turn the drawing 90° left" disabled={!canRotate} onClick={() => onRotate(-1)} />
          <ButtonRound size="sm" icon={<RotateCwSquare />} aria-label="Turn the drawing right" title="Turn the drawing 90° right" disabled={!canRotate} onClick={() => onRotate(1)} />
        </div>
      )}
      <SegmentedControl size="sm" aria-label="Zoom the preview">
        <Segment selected={zoom === "plotter"} onClick={() => onZoom("plotter")} title="Zoom out to the printer's full drawing area">
          Printer
        </Segment>
        <Segment selected={zoom === "paper"} disabled={!canPaper} onClick={() => onZoom("paper")} title="Zoom to the paper">
          Paper
        </Segment>
        <Segment selected={zoom === "drawing"} disabled={!canDrawing} onClick={() => onZoom("drawing")} title="Zoom to the drawing">
          Drawing
        </Segment>
      </SegmentedControl>
    </div>
  );
}
