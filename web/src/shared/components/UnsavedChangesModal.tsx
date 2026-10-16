import { useState } from "react";
import { Button, Modal } from "@tomcoggia/ui";
import { TriangleAlert } from "lucide-react";

interface Props {
  /** Whether something is waiting to replace the drawing. */
  open: boolean;
  /** The drawing's name, when it has been saved before. */
  name: string | null;
  /** Save it: true once it's saved, and only then does what was asked for go ahead. */
  onSave: () => Promise<boolean>;
  /** Lose the changes and go ahead. */
  onDiscard: () => void;
  /** Cancel: nothing happens. */
  onCancel: () => void;
}

/**
 * Shared: the question asked in all three apps before something would replace a drawing with changes
 * not saved - a new drawing, another opened, a file dropped. Save saves it first, then carries on:
 * wanting another drawing is rarely the same as wanting to lose this one. Cancel comes first, so a stray
 * Enter loses nothing.
 */
export function UnsavedChangesModal({ open, name, onSave, onDiscard, onCancel }: Props) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onCancel}
      icon={<TriangleAlert />}
      iconColor="danger"
      title="Unsaved changes"
      actions={
        <>
          <Button size="lg" variant="tertiary" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button size="lg" variant="secondary" tone="danger" disabled={saving} onClick={onDiscard}>Discard</Button>
          <Button size="lg" variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      {name ? `“${name}” has` : "This drawing has"} changes that aren’t saved. Discarded, they can’t be brought back.
    </Modal>
  );
}
