import type { ReactNode } from "react";
import { ButtonRound, InputText } from "@tomcoggia/ui";
import { Save } from "lucide-react";
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
  /** The question asked before a new drawing replaces one with unsaved work, when it's being asked. */
  confirm: ReactNode;
  onSave: () => void;
  /** Under which the card's folding is remembered: the app's own. */
  collapsibleKey: string;
}

/**
 * Shared: the File card's inside in all three apps - the drawing's name, where it's saved, and Save -
 * in the File card every app has (FileCard). In Studio and Image, opening, starting and sending are the
 * File toolbar's, in the left-hand column (FileToolbar); Save stays here, beside the name it saves under.
 */
export function FileSection({ name, onName, saved, dirty, hasShapes, busy, confirm, onSave, collapsibleKey }: Props) {
  return (
    <FileCard
      fileName={name || null}
      collapsibleKey={collapsibleKey}
      // The question about unsaved work is asked in here: never folded away while it's waiting.
      forceOpen={Boolean(confirm)}
      action={
        // A safety-toned round button: the half of "are you sure?" that keeps the work, and the one
        // button here that writes a file.
        <ButtonRound
          size="sm"
          tone="safety"
          icon={<Save />}
          aria-label="Save"
          title={`Save this drawing${saved ? ` to ${saved.folder}` : ""}`}
          disabled={busy || !hasShapes || !dirty}
          onClick={onSave}
        />
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
    </FileCard>
  );
}
