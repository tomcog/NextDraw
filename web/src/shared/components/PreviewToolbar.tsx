import { Segment, SegmentedControl, Spinner, Toolbar } from "@tomcoggia/ui";
import { Eye, EyeDashed, Grid3x3, ImageIcon, Redo2, Route, StickyNote, Undo2 } from "lucide-react";
import type { Zoom } from "./Bed";
import styles from "./PreviewToolbar.module.css";

/**
 * How the drawing is drawn: its paths as thin lines, the ink they will make, or - in Plot, while
 * there is a plot to show - how far the plot has got.
 */
export type View = "outline" | "preview" | "progress";

interface Props {
  view: View;
  onView: (view: View) => void;
  /** Plot only: offer the plot in progress as a third way to draw the drawing. Left out, it isn't offered. */
  canProgress?: boolean;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  canPaper?: boolean;
  canDrawing: boolean;
  /** Studio only: the drawing being made has a history. Plot's drawings are read, not changed, so it has none. */
  history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  disabled?: boolean;
  /** Something still being worked out about the view, said beside the bar with a spinner: Plot's plot time. */
  working?: string;
}

/**
 * Shared: both apps look at a drawing on the plotter's bed, and one bar over it says everything true
 * of what is being LOOKED AT - what has just been done to it, how it is drawn, and how close the view
 * sits. Figma: the `Toolbar` frame (44:360), which is three groups at a 16 gap inside a 4 inset.
 *
 * Each app brings only what it has: Studio its history, Plot the plot in progress. The groups they
 * share are the same buttons in the same order, so moving between the apps changes nothing about how
 * the page is looked at.
 *
 * Three SegmentedControls, as the mock draws them, each keeping the library's own grey well against
 * the white bar. Nothing here overrides the components.
 *
 * The history pair takes the control's `actions` mode: undo and redo are things you do, never a
 * choice one of which holds, so the track is a group of plain buttons rather than a radiogroup.
 * Nothing about it looks different.
 */
export function PreviewToolbar({ view, onView, canProgress, zoom, onZoom, canPaper = true, canDrawing, history, disabled, working }: Props) {
  return (
    <span className={styles.row}>
      <Toolbar tone="white" aria-label="Drawing view">
        {history && (
          <SegmentedControl size="sm" variant="dark" actions aria-label="History">
            <Segment
              icon={<Undo2 />}
              title="Undo the last change"
              disabled={disabled || !history.canUndo}
              onClick={history.onUndo}
            >
              Undo
            </Segment>
            <Segment
              icon={<Redo2 />}
              title="Redo the change just undone"
              disabled={disabled || !history.canRedo}
              onClick={history.onRedo}
            >
              Redo
            </Segment>
          </SegmentedControl>
        )}

        <SegmentedControl size="sm" variant="dark" aria-label="How the drawing is drawn">
          <Segment
            selected={view === "outline"}
            onClick={() => onView("outline")}
            icon={<EyeDashed />}
            title="Outline: every path as a thin line in its layer's colour - the paths themselves, quick to draw however many there are"
          >
            Outline
          </Segment>
          <Segment
            selected={view === "preview"}
            onClick={() => onView("preview")}
            icon={<Eye />}
            title="Preview: the ink - each tool's real width, how solid it is and how it darkens where strokes cross. Slow on a very large drawing"
          >
            Preview
          </Segment>
          {canProgress !== undefined && (
            <Segment
              selected={view === "progress"}
              disabled={!canProgress}
              onClick={() => onView("progress")}
              icon={<Route />}
              title="Progress: what's left to draw - lines already drawn turn green"
            >
              Progress
            </Segment>
          )}
        </SegmentedControl>

        <SegmentedControl size="sm" variant="dark" aria-label="Zoom the preview">
          <Segment
            selected={zoom === "plotter"}
            onClick={() => onZoom("plotter")}
            icon={<Grid3x3 />}
            title="Zoom out to the plotter's full drawing area"
          >
            Plotter
          </Segment>
          <Segment
            selected={zoom === "paper"}
            disabled={!canPaper}
            onClick={() => onZoom("paper")}
            icon={<StickyNote />}
            title="Zoom to the paper"
          >
            Paper
          </Segment>
          <Segment
            selected={zoom === "drawing"}
            disabled={!canDrawing}
            onClick={() => onZoom("drawing")}
            icon={<ImageIcon />}
            title="Zoom to the drawing"
          >
            Drawing
          </Segment>
        </SegmentedControl>
      </Toolbar>
      {working && (
        <span className={styles.status} role="status">
          <Spinner size={14} label={working} />
          {working}
        </span>
      )}
    </span>
  );
}
