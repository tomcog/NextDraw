import { useEffect, useRef, useState } from "react";
import { Segment, Toolbar, ToolbarExpander } from "@tomcoggia/ui";
import { Camera, File as FileIcon, FileInput, FilePlus, FolderInput, FolderOpen, ImagePlus, PenTool, Send } from "lucide-react";

interface Props {
  busy: boolean;
  /** Whether anything is drawn: what sending, snapshots and adding a layer need. */
  hasShapes: boolean;
  onOpen: () => void;
  /** Studio: another file onto this drawing, as a layer. */
  onAddLayer?: () => void;
  /** Image: a photo, or several separations, as a new drawing. */
  onOpenPhotos?: (files: File[]) => void;
  /** Image: a folder of separations - a grayscale image per ink - every file in it, for a layer each. */
  onOpenFolder?: (files: File[]) => void;
  onNew: () => void;
  /** Image: save, then carry on with the drawing in Studio - crop marks, words, anything drawn. */
  onEditInStudio?: () => void;
  /** A snapshot: the drawing with its images baked into lines, saved beside it as a new file. */
  onSnapshot?: () => void;
  onSendToPlot: () => void;
}

/**
 * Shared: the File toolbar, in the left-hand column of Studio and Image under the app switch - the
 * File button, opening down into what's done with whole drawings: another opened, a photo, a new one
 * started, and what is finished sent on. Saving stays on the File card, beside the name it saves
 * under. The buttons only one app has are passed in by that app.
 */
export function FileToolbar({ busy, hasShapes, onOpen, onAddLayer, onOpenPhotos, onOpenFolder, onNew, onEditInStudio, onSnapshot, onSendToPlot }: Props) {
  const photoInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // The drawer: its buttons each do one thing and fold it, so a click anywhere else in the app
  // folds it too, as the row menus do.
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof window.Node && drawer.current?.contains(e.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  return (
    <>
      <Toolbar tone="white" orientation="vertical" aria-label="File">
        <ToolbarExpander ref={drawer} size="sm" icon={<FileIcon />} label="File" actions open={open} onOpenChange={setOpen}>
          <Segment icon={<FolderOpen />} title="Open a drawing to carry on with" disabled={busy} onClick={onOpen}>
            Open a drawing
          </Segment>
          {/* Another file onto this drawing, a layer of its own: the browser's "Add as layer",
            without the ticking. */}
          {onAddLayer && (
            <Segment icon={<FileInput />} title="Add an SVG or Illustrator file to this drawing, as a new layer" disabled={busy || !hasShapes} onClick={onAddLayer}>
              Add as a layer
            </Segment>
          )}
          {/* A photo is opened rather than drawn: it becomes a new drawing, turned into lines. */}
          {onOpenPhotos && (
            <Segment
              icon={<ImagePlus />}
              title="Open an image to turn into lines, matched to the pen's colors: a new drawing. Pick several grayscale separations at once (…_C, …_M, …_Y, …_K) for a layer each"
              disabled={busy}
              onClick={() => photoInput.current?.click()}
            >
              Open an image
            </Segment>
          )}
          {onOpenFolder && (
            <Segment
              icon={<FolderInput />}
              title="Open a folder of separations: a grayscale image per ink, its name saying which (Portrait_Cyan, portrait-magenta…), each converted the same way onto a layer in its ink"
              disabled={busy}
              onClick={() => folderInput.current?.click()}
            >
              Open a folder of separations
            </Segment>
          )}
          <Segment icon={<FilePlus />} title="Close this drawing and start a new one" disabled={busy} onClick={onNew}>
            New drawing
          </Segment>
          {onEditInStudio && (
            <Segment icon={<PenTool />} title="Carry on with this drawing in Studio - changes not saved go too" disabled={busy || !hasShapes} onClick={onEditInStudio}>
              Edit in Studio
            </Segment>
          )}
          {onSnapshot && (
            <Segment icon={<Camera />} title="Snapshot: save a copy with the images baked into the lines they draw now - to carry on with as paths in Studio, or plot as it is. This drawing stays as it is" disabled={busy || !hasShapes} onClick={onSnapshot}>
              Snapshot
            </Segment>
          )}
          <Segment icon={<Send />} title="Plot this drawing - changes not saved go too" disabled={busy || !hasShapes} onClick={onSendToPlot}>
            Send to Plot
          </Segment>
        </ToolbarExpander>
      </Toolbar>
      {onOpenPhotos && (
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          multiple
          onChange={(e) => {
            onOpenPhotos([...(e.target.files ?? [])]);
            e.target.value = ""; // so the same photo can be opened again
          }}
        />
      )}
      {onOpenFolder && (
        <input
          ref={folderInput}
          type="file"
          hidden
          // The browser's folder picker: every file in the folder, and in any folders inside it.
          {...{ webkitdirectory: "" }}
          onChange={(e) => {
            onOpenFolder([...(e.target.files ?? [])]);
            e.target.value = ""; // so the same folder can be opened again
          }}
        />
      )}
    </>
  );
}
