import { useEffect, useRef, useState, type ReactNode } from "react";
import { ButtonRound, InputText, Segment, Toolbar, ToolbarExpander } from "@tomcoggia/ui";
import { File as FileIcon, FileInput, FilePlus, FolderOpen, ImagePlus, PenTool, Save, Send } from "lucide-react";
import { Section } from "./Section";
import controls from "./controls.module.css";
import styles from "./FileSection.module.css";

interface Props {
  /** The drawing's name, and where it was last saved, if it has been. */
  name: string;
  onName: (name: string) => void;
  saved: { path: string; folder: string } | null;
  /** Whether there is anything not yet saved, and anything drawn at all. */
  dirty: boolean;
  hasShapes: boolean;
  busy: boolean;
  /** The question asked before a new drawing replaces one with unsaved work, when it's being asked. */
  confirm: ReactNode;
  onOpen: () => void;
  /** Studio: another file onto this drawing, as a layer. */
  onAddLayer?: () => void;
  /** Photo: a photo, or several separations, as a new drawing. */
  onOpenPhotos?: (files: File[]) => void;
  onNew: () => void;
  /** Photo: save, then carry on with the drawing in Studio - crop marks, words, anything drawn. */
  onEditInStudio?: () => void;
  onSendToPlot: () => void;
  onSave: () => void;
}

/**
 * Shared: the File card - the drawing's name, where it's saved, and opening, starting, sending and
 * saving. The same card in Studio and Photo; the buttons only one app has are passed in by that app.
 */
export function FileSection({ name, onName, saved, dirty, hasShapes, busy, confirm, onOpen, onAddLayer, onOpenPhotos, onNew, onEditInStudio, onSendToPlot, onSave }: Props) {
  const photoInput = useRef<HTMLInputElement>(null);
  // The drawer: its buttons each do one thing and fold it, so a click anywhere else in the app
  // folds it too, as the row menus do.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof window.Node && drawer.current?.contains(e.target))) setDrawerOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [drawerOpen]);

  return (
    <Section
      title="File"
      action={
        <span className={styles.headerTools}>
          {/* Opening, starting and sending sit in a drawer behind the File button; Save stays out,
            furthest right, as the one done most. The row is held to the card's right edge, so the
            drawer opening pushes the File button left and stays to the left of Save. It reads in
            the order they come up: another drawing opened, a photo, a new one started, and what
            is finished sent to Plot. */}
          <Toolbar tone="white" aria-label="File">
            <ToolbarExpander
              ref={drawer}
              size="sm"
              icon={<FileIcon />}
              label="File"
              actions
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
            >
              <Segment icon={<FolderOpen />} hideLabel title="Open a drawing to carry on with" disabled={busy} onClick={onOpen}>
                Open a drawing
              </Segment>
              {/* Another file onto this drawing, a layer of its own: the browser's "Add as layer",
                without the ticking. */}
              {onAddLayer && (
              <Segment icon={<FileInput />} hideLabel title="Add an SVG or Illustrator file to this drawing, as a new layer" disabled={busy || !hasShapes} onClick={onAddLayer}>
                Add as a layer
              </Segment>
              )}
              {/* A photo is opened rather than drawn: it becomes a new drawing, turned into lines. */}
              {onOpenPhotos && (
              <Segment
                icon={<ImagePlus />}
                hideLabel
                title="Open an image to turn into lines, matched to the pen's colors: a new drawing. Pick several grayscale separations at once (…_C, …_M, …_Y, …_K) for a layer each"
                disabled={busy}
                onClick={() => photoInput.current?.click()}
              >
                Open an image
              </Segment>
              )}
              <Segment icon={<FilePlus />} hideLabel title="Close this drawing and start a new one" disabled={busy} onClick={onNew}>
                New drawing
              </Segment>
              {onEditInStudio && (
                <Segment icon={<PenTool />} hideLabel title="Save this drawing and carry on with it in Studio, in its own tab" disabled={busy || !hasShapes} onClick={onEditInStudio}>
                  Edit in Studio
                </Segment>
              )}
              <Segment icon={<Send />} hideLabel title="Save this drawing and open it in Plot, ready to draw" disabled={busy || !hasShapes} onClick={onSendToPlot}>
                Send to Plot
              </Segment>
            </ToolbarExpander>
          </Toolbar>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            hidden
            multiple
            onChange={(e) => {
              onOpenPhotos?.([...(e.target.files ?? [])]);
              e.target.value = ""; // so the same photo can be opened again
            }}
          />
          {/* A safety-toned round button: the half of "are you sure?" that keeps the
            work, and the one button here that writes a file. */}
          <ButtonRound
            size="sm"
            tone="safety"
            icon={<Save />}
            aria-label="Save"
            title={`Save this drawing${saved ? ` to ${saved.folder}` : ""}`}
            disabled={busy || !hasShapes || !dirty}
            onClick={onSave}
          />
        </span>
      }
    >
      <InputText
        size="md"
        label="Name"
        // The card is called File and the field holds the drawing's name: saying so twice under
        // the words themselves helps nobody who can see them.
        hideLabel
        value={name}
        disabled={busy}
        onChange={(e) => onName(e.target.value)}
      />
      <p className={controls.fileWhere} title={saved?.path ?? undefined}>
        {saved ? saved.folder : "Not saved yet"}
      </p>

      {confirm}
    </Section>
  );
}
