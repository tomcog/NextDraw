import { useState, type ReactNode } from "react";
import { Button, InputText } from "@tomcoggia/ui";
import styles from "./SaveAs.module.css";

/**
 * Shared: a Save button that asks for the name underneath it, in the card, rather than in a pop-up.
 *
 * Not window.prompt. An embedded browser is entitled to refuse these, and the Claude app's Browser
 * pane does: prompt() throws there and confirm() answers no, neither of them showing anything - so a
 * save would quietly never happen, which is how it was found.
 *
 * One question, not two: a name already taken says Replace on the button rather than asking again
 * once it has been typed. Enter keeps, Escape puts the field away.
 */
export function SaveAs({ label, what, suggest, taken, title, disabled, beside, onSave }: {
  /** The button that opens it: "Save ink set". */
  label: string;
  /** What is being named, for the field: "ink set", "preset", "edge mask". */
  what: string;
  /** What the field holds to start with. */
  suggest: string;
  /** The names already in use, so one of them says Replace. */
  taken: string[];
  title?: string;
  disabled?: boolean;
  /** A button beside the save one - Delete - at its own width rather than sharing it. */
  beside?: ReactNode;
  /** Save under this name. True once it is saved, which puts the field away; false leaves it up. */
  onSave: (name: string) => Promise<boolean>;
}) {
  // null while nothing is being named, otherwise what has been typed so far.
  const [typed, setTyped] = useState<string | null>(null);
  const name = (typed ?? "").replace(/[/\\:]/g, "-").trim();
  const keep = () => {
    if (!name) return;
    void onSave(name).then((saved) => { if (saved) setTyped(null); });
  };
  return (
    <>
      <div className={styles.row}>
        <Button size="sm" variant="secondary" disabled={disabled} title={title} onClick={() => setTyped(typed === null ? suggest : null)}>
          {label}
        </Button>
        {beside}
      </div>
      {typed !== null && (
        <>
          <InputText
            size="md"
            label={`Name for this ${what}`}
            hideLabel
            aria-label={`Name for this ${what}`}
            placeholder={`Name for this ${what}`}
            value={typed}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTyped(null);
              if (e.key !== "Enter") return;
              e.preventDefault();
              keep();
            }}
          />
          <div className={styles.buttons}>
            <Button size="sm" variant="primary" disabled={!name} onClick={keep}>{taken.includes(name) ? "Replace" : "Save"}</Button>
            <Button size="sm" variant="secondary" onClick={() => setTyped(null)}>Cancel</Button>
          </div>
        </>
      )}
    </>
  );
}
