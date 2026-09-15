import { Segment, SegmentedControl, Spinner } from "@tomcoggia/ui";
import { FileImage, Grid3x3, StickyNote } from "lucide-react";
import styles from "./Bed.module.css";
import type { Zoom } from "./Bed";

interface Props {
  zoom: Zoom;
  canPaper: boolean;
  canDrawing: boolean;
  onZoom: (zoom: Zoom) => void;
  updating: boolean; // the plot simulation is still working out pen paths and time
}

// Preset zooms for the preview: the plotter's full area, the paper, or the drawing. Bed places it on
// the width dimension line.
export function ZoomControl({ zoom, canPaper, canDrawing, onZoom, updating }: Props) {
  return (
    <div className={styles.zoom}>
      {updating && canDrawing && (
        <span className={styles.updating} role="status">
          <Spinner size={14} label="Updating" />
          Updating plot time…
        </span>
      )}
      <SegmentedControl size="sm" aria-label="Zoom the preview">
        <Segment selected={zoom === "plotter"} onClick={() => onZoom("plotter")} icon={<Grid3x3 />} aria-label="Plotter" title="Zoom out to the plotter's full drawing area" />
        <Segment selected={zoom === "paper"} disabled={!canPaper} onClick={() => onZoom("paper")} icon={<StickyNote />} aria-label="Paper" title="Zoom to the paper" />
        <Segment selected={zoom === "drawing"} disabled={!canDrawing} onClick={() => onZoom("drawing")} icon={<FileImage />} aria-label="Drawing" title="Zoom to the drawing" />
      </SegmentedControl>
    </div>
  );
}
