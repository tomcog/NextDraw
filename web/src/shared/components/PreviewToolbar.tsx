import { Segment, SegmentedControl, Spinner, Toolbar } from "@tomcoggia/ui";
import { Camera, Eye, EyeDashed, Grid3x3, ImageIcon, Redo2, Route, Search, StickyNote, Undo2 } from "lucide-react";
import type { Zoom } from "./Bed";
import styles from "./PreviewToolbar.module.css";

/**
 * How the drawing is drawn: its paths as thin lines, the ink they will make, or - in Plot, while
 * there is a plot to show - how far the plot has got.
 */
export type View = "outline" | "preview" | "progress" | "photo";

interface Props {
  view: View;
  onView: (view: View) => void;
  /** Plot only: offer the plot in progress as a third way to draw the drawing. Left out, it isn't offered. */
  canProgress?: boolean;
  /** Studio only: offer the photos the drawing's lines are made from, as pictures. Left out, it isn't offered. */
  canPhoto?: boolean;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  canPaper?: boolean;
  canDrawing: boolean;
  /** Studio only: the drawing being made has a history. Plot's drawings are read, not changed, so it has none. */
  history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
  disabled?: boolean;
  /** The loupe: a lens that follows the pointer over the drawing, magnified. */
  loupe?: boolean;
  onLoupe?: (on: boolean) => void;
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
 * the white bar. Nothing here overrides the components. Icons only: what each does is in its
 * tooltip and read out by name, and the bar leaves more of the line for the measurement.
 *
 * The history pair takes the control's `actions` mode: undo and redo are things you do, never a
 * choice one of which holds, so the track is a group of plain buttons rather than a radiogroup.
 * Nothing about it looks different.
 */
export function PreviewToolbar({ view, onView, canProgress, canPhoto, zoom, onZoom, canPaper = true, canDrawing, history, disabled, working, loupe, onLoupe }: Props) {
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
              aria-label="Undo"
            />
            <Segment
              icon={<Redo2 />}
              title="Redo the change just undone"
              disabled={disabled || !history.canRedo}
              onClick={history.onRedo}
              aria-label="Redo"
            />
          </SegmentedControl>
        )}

        <SegmentedControl size="sm" variant="dark" aria-label="How the drawing is drawn">
          <Segment
            selected={view === "outline"}
            onClick={() => onView("outline")}
            icon={<EyeDashed />}
            title="Outline: every path as a thin line in its layer's colour - the paths themselves, quick to draw however many there are"
            aria-label="Outline"
          />
          <Segment
            selected={view === "preview"}
            onClick={() => onView("preview")}
            icon={<Eye />}
            title="Preview: the ink - each tool's real width, how solid it is and how it darkens where strokes cross. Slow on a very large drawing"
            aria-label="Preview"
          />
          {canPhoto && (
            <Segment
              selected={view === "photo"}
              onClick={() => onView("photo")}
              icon={<Camera />}
              aria-label="Photo"
              title="Photo: the photos themselves, where their lines are, to compare the drawing against"
            />
          )}
          {canProgress !== undefined && (
            <Segment
              selected={view === "progress"}
              disabled={!canProgress}
              onClick={() => onView("progress")}
              icon={<Route />}
              title="Progress: what's left to draw - lines already drawn turn green"
              aria-label="Progress"
            />
          )}
        </SegmentedControl>

        <SegmentedControl size="sm" variant="dark" aria-label="Zoom the preview">
          <Segment
            selected={zoom === "plotter"}
            onClick={() => onZoom("plotter")}
            icon={<Grid3x3 />}
            title="Zoom out to the plotter's full drawing area"
            aria-label="Plotter"
          />
          <Segment
            selected={zoom === "paper"}
            disabled={!canPaper}
            onClick={() => onZoom("paper")}
            icon={<StickyNote />}
            title="Zoom to the paper"
            aria-label="Paper"
          />
          <Segment
            selected={zoom === "drawing"}
            disabled={!canDrawing}
            onClick={() => onZoom("drawing")}
            icon={<ImageIcon />}
            title="Zoom to the drawing"
            aria-label="Drawing"
          />
        </SegmentedControl>

        {onLoupe && (
          // A look, not a change: it sits with the zoom, as a switch of its own.
          // A switch, so the track is a plain button rather than a radio: a radio group selects on
          // focus, and a click would turn the loupe on and straight back off.
          <SegmentedControl size="sm" variant="dark" actions aria-label="Loupe">
            <Segment
              aria-pressed={Boolean(loupe)}
              className={loupe ? styles.on : undefined}
              onClick={() => onLoupe(!loupe)}
              icon={<Search />}
              title={loupe ? "Put the loupe away" : "Loupe: a lens that follows the pointer for a close look at the lines. Scroll to magnify more or less"}
              aria-label="Loupe"
            />
          </SegmentedControl>
        )}
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
