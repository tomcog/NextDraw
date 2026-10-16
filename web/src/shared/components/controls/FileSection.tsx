import { ButtonRound, InputText } from "@tomcoggia/ui";
import { FilePlus, FolderOpen, Save } from "lucide-react";
import { FileCard } from "./FileCard";
import controls from "./controls.module.css";

interface Props {
  /** The drawing's name, and where it was last saved, if it has been. */
  name: string;
  onName: (name: string) => void;
  saved: { path: string; folder: string } | null;
  /** Whether there is anything not yet saved, and anything drawn at all. */
  dirty: boolean;
  hasShapes: boolean;
  busy: boolean;
  onSave: () => void;
  /** Open another drawing in this one's place: the file browser, which asks about unsaved work. */
  onOpen: () => void;
  /** Close this drawing and start a new, empty one - asking first about unsaved work. */
  onNew: () => void;
  /** Under which the card's folding is remembered: the app's own. */
  collapsibleKey: string;
}

/**
 * Shared: the File card's inside in all three apps - the drawing's name, where it's saved, and New,
 * Open and Save - in the File card every app has (FileCard).
 */
export function FileSection({ name, onName, saved, dirty, hasShapes, busy, onSave, onOpen, onNew, collapsibleKey }: Props) {
  // A safety-toned round button: the half of "are you sure?" that keeps the work, and the one button
  // here that writes a file. Folded, the card keeps it beside the drawing's name.
  const save = (
    <ButtonRound
      size="sm"
      tone="safety"
      icon={<Save />}
      aria-label="Save"
      title={`Save this drawing${saved ? ` to ${saved.folder}` : ""}`}
      disabled={busy || !hasShapes || !dirty}
      onClick={onSave}
    />
  );
  return (
    <FileCard
      fileName={name || null}
      collapsibleKey={collapsibleKey}
      action={
        <span className={controls.headerTools}>
          <ButtonRound size="sm" icon={<FilePlus />} aria-label="New drawing" title="Close this drawing and start a new one" disabled={busy} onClick={onNew} />
          <ButtonRound size="sm" icon={<FolderOpen />} aria-label="Open a drawing" title="Open another drawing in this one's place" disabled={busy} onClick={onOpen} />
          {save}
        </span>
      }
      keep={save}
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
    </FileCard>
  );
}
