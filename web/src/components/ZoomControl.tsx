import { Segment, SegmentedControl } from "@tomcoggia/ui";
import styles from "./Bed.module.css";
import type { Zoom } from "./Bed";

interface Props {
  zoom: Zoom;
  canPaper: boolean;
  canDrawing: boolean;
  onZoom: (zoom: Zoom) => void;
}

// Preset zooms for the preview: the plotter's full area, the paper, or the drawing. Floats over the
// bottom right of the preview.
export function ZoomControl({ zoom, canPaper, canDrawing, onZoom }: Props) {
  return (
    <div className={styles.toolbar}>
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
