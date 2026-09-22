import type { Plot } from "../lib/types";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonRound, InputText, Segment, SegmentedControl, Spinner } from "@tomcoggia/ui";
import { ArrowUp, FileImage, Folder, FolderPlus, PenTool, X } from "lucide-react";
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
  // The top-level folders drawings can come from. "added" ones were typed in by hand and can go again.
  roots: { name: string; path: string; added?: boolean }[];
  folders: Entry[];
  files: Entry[];
}

export interface OpenResult {
  name: string;
  path: string;
  folder: string;
  plot?: Plot | null; // Plot's own route loads the drawing and answers with its settings
  svg?: string; // Studio's route reads the file instead, so picking one to edit doesn't load it
  opened?: string; // which opening this is, to tell it from any other load of the same file
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpened: (result: OpenResult) => void;
  /** What picking a file means. Plot loads it; Studio reads it for editing. */
  endpoint?: string;
}

// Where the browser opens, in both apps: the last folder browsed, or the folder of the drawing last
// saved or opened, so a file just saved in Studio is the first thing Plot's browser shows.
export const LAST_FOLDER_KEY = "nextdraw-studio-last-folder";

const fmtSize = (bytes = 0) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const fmtDate = (seconds = 0) =>
  new Date(seconds * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Browse the folders the server allows and open an SVG, or import an Illustrator file as SVG.
export function FileBrowser({ open, onClose, onOpened, endpoint = "/api/open" }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null); // what's happening, while busy
  const [choice, setChoice] = useState<{ file: Entry; svgName: string } | null>(null);
  const [adding, setAdding] = useState(false); // the "add a folder" row is open
  const [newFolder, setNewFolder] = useState("");

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

  // Which root the listing is inside, so an added one can be dropped from where you are standing.
  const here = listing?.roots.find(
    (root) => listing.path === root.path || listing.path.startsWith(root.path + "/"),
  );

  const addFolder = async () => {
    setError(null);
    setWorking(`Adding ${newFolder.trim()}…`);
    try {
      const res = await postJSON<{ folders: { path: string }[] }>("/api/folders", { path: newFolder.trim() });
      setAdding(false);
      setNewFolder("");
      await browse(res.folders[res.folders.length - 1]?.path); // show what was just added
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const forgetFolder = async (path: string) => {
    setError(null);
    setWorking("Forgetting that folder…");
    try {
      await api("/api/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      await browse(); // back to the first folder, since this one is no longer listed
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const openFile = async (file: Entry, mode?: "existing" | "import") => {
    setError(null);
    setChoice(null);
    const importing = file.kind === "ai" && mode !== "existing";
    setWorking(importing ? `Importing ${file.name} from Illustrator… This can take a few seconds.` : `Opening ${file.name}…`);
    try {
      // Plot posts, because opening makes the file the loaded drawing. Studio reads it back, so a
      // GET is enough. Either can import an Illustrator file and ask which copy to use, so both
      // carry the answer.
      type Opened = OpenResult & { choice?: boolean; svg_name?: string };
      const query = `?path=${encodeURIComponent(file.path)}${mode ? `&mode=${mode}` : ""}`;
      const res: Opened = endpoint === "/api/open"
        ? await postJSON<Opened>(endpoint, { path: file.path, mode })
        : await api<Opened>(`${endpoint}${query}`);
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
        {listing && (
          <div className={styles.roots}>
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
            <ButtonRound
              size="sm"
              icon={<FolderPlus />}
              aria-label="Add a folder"
              title="Add a folder to open drawings from"
              disabled={Boolean(working)}
              onClick={() => { setAdding((was) => !was); setError(null); }}
            />
            {here?.added && (
              <ButtonRound
                size="sm"
                icon={<X />}
                aria-label={`Stop opening drawings from ${here.name}`}
                title={`Stop opening drawings from ${here.name}`}
                disabled={Boolean(working)}
                onClick={() => forgetFolder(here.path)}
              />
            )}
          </div>
        )}
        {adding && (
          <form
            className={styles.addFolder}
            onSubmit={(e) => { e.preventDefault(); addFolder(); }}
          >
            <InputText
              size="md"
              autoFocus
              label="Folder to add"
              placeholder="~/Documents/Drawings"
              value={newFolder}
              disabled={Boolean(working)}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                // The dialog swallows the form's implicit submit, so Enter is wired up by hand.
                if (e.key === "Enter" && newFolder.trim() && !working) {
                  e.preventDefault();
                  addFolder();
                }
              }}
            />
            <Button size="sm" variant="primary" type="submit" disabled={Boolean(working) || !newFolder.trim()}>Add</Button>
            <Button size="sm" variant="ghost" type="button" disabled={Boolean(working)} onClick={() => { setAdding(false); setNewFolder(""); }}>Cancel</Button>
          </form>
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
