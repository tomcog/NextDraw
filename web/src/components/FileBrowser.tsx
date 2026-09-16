import type { Plot } from "../lib/types";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonRound, Segment, SegmentedControl, Spinner } from "@tomcoggia/ui";
import { ArrowUp, FileImage, Folder, PenTool } from "lucide-react";
import styles from "./FileBrowser.module.css";
import { api, postJSON } from "../lib/api";
import { load, save } from "../lib/storage";

interface Entry {
  name: string;
  path: string;
  kind?: "svg" | "ai";
  size?: number;
  modified?: number;
  has_svg?: boolean;
}

interface Listing {
  path: string;
  display: string;
  parent: string | null;
  roots: { name: string; path: string }[]; // the top-level folders drawings can come from
  folders: Entry[];
  files: Entry[];
}

export interface OpenResult {
  name: string;
  path: string;
  folder: string;
  plot: Plot | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpened: (result: OpenResult) => void;
}

const LAST_FOLDER_KEY = "nextdraw-studio-last-folder";

const fmtSize = (bytes = 0) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const fmtDate = (seconds = 0) =>
  new Date(seconds * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Browse the folders the server allows and open an SVG, or import an Illustrator file as SVG.
export function FileBrowser({ open, onClose, onOpened }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null); // what's happening, while busy
  const [choice, setChoice] = useState<{ file: Entry; svgName: string } | null>(null);

  const browse = async (path?: string) => {
    setError(null);
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const next = await api<Listing>(`/api/browse${query}`);
      setListing(next);
      save(LAST_FOLDER_KEY, next.path);
    } catch (err) {
      setError((err as Error).message);
      if (path) browse(); // fall back to the first allowed folder
    }
  };

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setChoice(null);
      setWorking(null);
      browse(load<string>(LAST_FOLDER_KEY) ?? undefined);
    } else if (!open && el.open) {
      el.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openFile = async (file: Entry, mode?: "existing" | "import") => {
    setError(null);
    setChoice(null);
    const importing = file.kind === "ai" && mode !== "existing";
    setWorking(importing ? `Importing ${file.name} from Illustrator… This can take a few seconds.` : `Opening ${file.name}…`);
    try {
      const res = await postJSON<OpenResult & { choice?: boolean; svg_name?: string }>("/api/open", { path: file.path, mode });
      if (res.choice) {
        setChoice({ file, svgName: res.svg_name ?? "" });
        return;
      }
      onOpened(res);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(null);
    }
  };

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose} onCancel={(e) => { if (working) e.preventDefault(); }}>
      <div className={styles.header}>
        <h2 className={styles.title}>Open drawing</h2>
        {listing && listing.roots.length > 1 && (
          <SegmentedControl size="sm" aria-label="Folder">
            {listing.roots.map((root) => (
              <Segment
                key={root.path}
                selected={listing.path === root.path || listing.path.startsWith(root.path + "/")}
                disabled={Boolean(working)}
                onClick={() => browse(root.path)}
              >
                {root.name}
              </Segment>
            ))}
          </SegmentedControl>
        )}
        <div className={styles.location}>
          <ButtonRound
            size="sm"
            icon={<ArrowUp />}
            aria-label="Up one folder"
            title="Up one folder"
            disabled={!listing?.parent || Boolean(working)}
            onClick={() => listing?.parent && browse(listing.parent)}
          />
          <span className={styles.path} title={listing?.path}>{listing?.display ?? "…"}</span>
        </div>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {choice ? (
        <div className={styles.panel}>
          <p>{`${choice.svgName} already exists next to ${choice.file.name}.`}</p>
          <p className={styles.muted}>Open it to keep the changes saved in it, or import again if you’ve changed the artwork in Illustrator.</p>
          <div className={styles.buttons}>
            <Button size="md" variant="ghost" onClick={() => setChoice(null)}>Back</Button>
            <Button size="md" variant="secondary" onClick={() => openFile(choice.file, "import")}>Import again</Button>
            <Button size="md" variant="primary" autoFocus onClick={() => openFile(choice.file, "existing")}>Open existing</Button>
          </div>
        </div>
      ) : working ? (
        <div className={styles.panel}>
          <Spinner size={28} label="Working" />
          <p>{working}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {listing?.folders.map((folder) => (
            <li key={folder.path}>
              <button type="button" className={styles.row} onClick={() => browse(folder.path)}>
                <Folder className={styles.icon} aria-hidden="true" />
                <span className={styles.name}>{folder.name}</span>
              </button>
            </li>
          ))}
          {listing?.files.map((file) => (
            <li key={file.path}>
              <button type="button" className={styles.row} onClick={() => openFile(file)}>
                {file.kind === "ai"
                  ? <PenTool className={styles.icon} aria-hidden="true" />
                  : <FileImage className={styles.icon} aria-hidden="true" />}
                <span className={styles.name}>{file.name}</span>
                <span className={styles.meta}>
                  {file.kind === "ai" ? "Illustrator, imports as SVG" : "SVG"}
                </span>
                <span className={styles.meta}>{`${fmtSize(file.size)}, ${fmtDate(file.modified)}`}</span>
              </button>
            </li>
          ))}
          {listing && !listing.folders.length && !listing.files.length && (
            <li className={styles.empty}>No SVG or Illustrator files in this folder.</li>
          )}
        </ul>
      )}

      <div className={styles.footer}>
        <Button size="md" variant="ghost" disabled={Boolean(working)} onClick={onClose}>Cancel</Button>
      </div>
    </dialog>
  );
}
