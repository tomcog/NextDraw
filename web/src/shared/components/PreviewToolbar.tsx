import { Segment, SegmentedControl, Spinner, Toolbar } from "@tomcoggia/ui";
import { Camera, Eye, EyeDashed, Grid3x3, ImageIcon, Redo2, Route, Search, Settings, StickyNote, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Zoom } from "./Bed";
import styles from "./PreviewToolbar.module.css";

/**
 * How the drawing is drawn: its paths as thin lines, the ink they will make, or - in Plot, while
 * there is a plot to show - how far the plot has got.
 */
export type View = "outline" | "preview" | "progress" | "photo";

export interface PreviewToolbarProps {
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
  /** The loupe: a lens that follows the pointer over the drawing, magnified. */
  loupe?: boolean;
  onLoupe?: (on: boolean) => void;
  /** Something still being worked out about the view, said beside the bar with a spinner: Plot's plot time. */
  working?: string;
  /** An app's own controls for the view, in their own bar ahead of the shared one: Photo's picture, lines and side by side. */
  extras?: ReactNode;
}

/**
 * Shared: every app looks at a drawing on the plotter's bed, and one bar over it says everything true
 * of how it is LOOKED AT - how it is drawn, and how close the view sits. What changes the drawing -
 * undo and redo - isn't here but in the toolbars down the left (HistoryToolbar). Figma: the `Toolbar` frame (44:360), which is three groups at a 16 gap inside a 4 inset.
 *
 * Each app brings only what it has: Plot the plot in progress, Photo its own views. The groups they
 * share are the same buttons in the same order, so moving between the apps changes nothing about how
 * the page is looked at.
 *
 * Three SegmentedControls, as the mock draws them, each keeping the library's own grey well against
 * the white bar. Nothing here overrides the components. Icons only: what each does is in its
 * tooltip and read out by name, and the bar leaves more of the line for the measurement.
 */
export function PreviewToolbar({ view, onView, canProgress, canPhoto, zoom, onZoom, canPaper = true, canDrawing, working, loupe, onLoupe, extras }: PreviewToolbarProps) {
  return (
    <span className={styles.row}>
      {/* What an app shows beyond the shared views, in a bar of its own ahead of the shared one -
          Photo's picture, its lines, both, side by side - so the shared bar is the same in every app. */}
      {extras && (
        <Toolbar tone="white" aria-label="App view">
          {extras}
        </Toolbar>
      )}
      <Toolbar tone="white" aria-label="Drawing view">
        <SegmentedControl size="sm" variant="dark" aria-label="How the drawing is drawn">
          <Segment
            selected={view === "outline"}
            onClick={() => onView("outline")}
            icon={<EyeDashed />}
            title="Outline: every path as a thin line in its layer's color - the paths themselves, quick to draw however many there are"
            aria-label="Outline"
          />
          <Segment
            selected={view === "preview"}
            onClick={() => onView("preview")}
            icon={<Eye />}
            title="Preview: the ink - each pen's real width, how solid it is and how it darkens where strokes cross. Slow on a very large drawing"
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


        <ZoomControls zoom={zoom} onZoom={onZoom} canPaper={canPaper} canDrawing={canDrawing} loupe={loupe} onLoupe={onLoupe} />
      </Toolbar>
      {working ? (
        <span className={styles.status} role="status">
          <Spinner size={14} label={working} />
          {working}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The way to Setup: a bar of its own, holding one switch - at the bottom of the app's toolbars down
 * the left (stood upright), once at the far end of the width line. Set apart
 * from the view controls because it isn't a way of looking at the drawing but a different part of the
 * app - where the drawing tools are got ready - and pressed, like the loupe, while you're in it.
 */
export function SetupToolbar({ open, onToggle, orientation }: { open: boolean; onToggle: () => void; orientation?: "horizontal" | "vertical" }) {
  return (
    <span className={styles.row}>
      <Toolbar tone="white" orientation={orientation} aria-label="Setup">
        <SegmentedControl size="sm" variant="dark" actions aria-label="Setup">
          <Segment
            aria-pressed={open}
            className={open ? styles.on : undefined}
            onClick={onToggle}
            icon={<Settings />}
            title={open ? "Back to the drawing" : "Setup: getting the pens ready - calibrating their colors"}
            aria-label="Setup"
          />
        </SegmentedControl>
      </Toolbar>
    </span>
  );
}

/**
 * How close the view sits - the plotter's whole drawing area, the paper, or the drawing - and the
 * loupe beside it, as a switch of its own. Shared by every app that looks at a drawing on the bed, in
 * whatever bar it has: Studio's and Plot's here, Photo's over its conversion panes. Its loupe switch
 * takes its red from the bar's row, so it goes inside a `.row` (ZOOM_ROW).
 */
export function ZoomControls({ zoom, onZoom, canPaper = true, canDrawing, loupe, onLoupe }: {
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  canPaper?: boolean;
  canDrawing: boolean;
  loupe?: boolean;
  onLoupe?: (on: boolean) => void;
}) {
  return (
    <>
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
            title={loupe ? "Put the loupe away" : "Loupe: a lens that follows the pointer for a close look at the lines. Click to pin it over one spot while you change settings; click the lens to let it follow again. Scroll to magnify more or less"}
            aria-label="Loupe"
          />
        </SegmentedControl>
      )}
    </>
  );
}

/** The class a bar holding ZoomControls sits in, so the loupe's switch shows red while it's out. */
export const ZOOM_ROW = styles.row;

/**
 * Undo and redo, as a bar of their own at the foot of the toolbars down the left, just above Setup -
 * in every app whose drawing changes (Studio, Photo; Plot only reads). They change the drawing, where
 * the bar over the canvas only changes how it's looked at. The control's `actions` mode: undo and redo
 * are things you do, never a choice one of which holds.
 */
export function HistoryToolbar({ canUndo, canRedo, onUndo, onRedo, disabled }: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; disabled?: boolean }) {
  return (
    <Toolbar tone="white" orientation="vertical" aria-label="History">
      <SegmentedControl size="sm" variant="dark" actions aria-label="History">
        <Segment icon={<Undo2 />} title="Undo the last change" disabled={disabled || !canUndo} onClick={onUndo} aria-label="Undo" />
        <Segment icon={<Redo2 />} title="Redo the change just undone" disabled={disabled || !canRedo} onClick={onRedo} aria-label="Redo" />
      </SegmentedControl>
    </Toolbar>
  );
}
