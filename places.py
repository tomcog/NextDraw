"""Where everything lives on this Mac: the working folder, the open drawing, the queue, the presets,
the folders the file browser may open drawings from (Tom, 2026-11-24).

Paths, the few helpers that read them, and the one that writes a file safely, and nothing else.
Every other module can ask here without asking server.py, which is what lets the plotter and the
drawing's own code be read apart from the routes that drive them.
"""
import json
import os
import re
import shutil
import tempfile
from pathlib import Path


# The address is fixed so that every app, Mac, bookmark and phone can assume it: Plot at 5055, with
# nothing to remember and nothing to pass on. NEXTDRAW_PORT moves it, which is for a second copy
# running beside the real one. It moves the address and nothing else: both copies still read this
# Mac's jobs folder below and talk to the one plotter, so a second copy is for looking at, not for
# plotting from. A value that isn't a port number is ignored, because a typo in the environment
# shouldn't be the thing that stops the app from starting.
def _port():
    asked = os.environ.get("NEXTDRAW_PORT", "").strip()
    return int(asked) if asked.isdigit() and 0 < int(asked) < 65536 else 5055


HOST, PORT = "127.0.0.1", _port()
ROOT = Path(__file__).parent
# This Mac's own working state - the open drawing, a plot to resume, the settings every page shows.
# Kept out of the app folder, which is in iCloud Drive: two Macs sharing one copy each took up the
# other's open drawing, and refused to save it once iCloud had rewritten its modified time.
JOBS = Path.home() / "Library" / "Application Support" / "NextDraw Plot" / "jobs"
OLD_JOBS = ROOT / "jobs"  # where it was kept before


def move_in_old_jobs():
    """
    Start from what the app folder's jobs/ held, the first time this Mac keeps its own. Copied, not
    moved: the other Mac takes its own copy when it starts. iCloud's "current 2.svg" duplicates are
    left behind, and so is the drawing's recorded modified time, which another Mac may have written.
    """
    if JOBS.exists() or not OLD_JOBS.is_dir():
        return
    JOBS.mkdir(parents=True)
    for old in OLD_JOBS.iterdir():
        if old.is_file() and not re.search(r" \d+\.\w+$", old.name) and old.name != "current.mtime":
            shutil.copy2(old, JOBS / old.name)


move_in_old_jobs()
JOBS.mkdir(parents=True, exist_ok=True)
CURRENT_SVG = JOBS / "current.svg"
CURRENT_MTIME = JOBS / "current.mtime"  # the file's modified time when opened or last saved, to catch outside edits
CURRENT_OPENED = JOBS / "current.opened"  # changes each time a drawing is opened, by anyone
CURRENT_HASH = JOBS / "current.hash"  # and a hash of its bytes, so the page can be told it changed
CURRENT_PATH = JOBS / "current.path"  # where the loaded drawing lives on disk; absent for uploaded copies
# The editors' side of the same drawing (see /api/current): whether it has changes not saved to its
# file, where a first save goes, marks the editors can't redraw, and which edit it is.
CURRENT_STATE = JOBS / "current.json"


# Presets (pen settings and palettes) live in iCloud Drive when it's available, so every Mac signed in
# to the same account shares them. The copy in the app folder seeds it the first time, and is used
# as-is on a Mac without iCloud Drive.
BUNDLED_PRESETS = ROOT / "presets.json"
ICLOUD_DRIVE = Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
PRESETS_FILE = ICLOUD_DRIVE / "NextDraw Studio" / "presets.json" if ICLOUD_DRIVE.is_dir() else BUNDLED_PRESETS

# Folders the file browser may open and save drawings in, with the names it shows. Nothing outside
# these is listed or written. The iCloud Drive one syncs drawings between Macs, like the presets.
ICLOUD_DRAWINGS = ICLOUD_DRIVE / "NextDraw Studio" / "Drawings"
if ICLOUD_DRIVE.is_dir():
    ICLOUD_DRAWINGS.mkdir(parents=True, exist_ok=True)
# Drawing folders of your own in iCloud Drive, named as they are there. A folder that isn't on this
# Mac (or hasn't synced yet) is simply left out of the list.
ICLOUD_FOLDERS = ("ROBOT DRAWING MACHINE", "BANTAM SHARE")
BUILT_IN_FOLDERS = {Path.home() / "Desktop": "Desktop"}
if ICLOUD_DRAWINGS.is_dir():
    BUILT_IN_FOLDERS[ICLOUD_DRAWINGS] = "iCloud Drawings"
for folder in ICLOUD_FOLDERS:
    if (ICLOUD_DRIVE / folder).is_dir():
        BUILT_IN_FOLDERS[ICLOUD_DRIVE / folder] = folder.title()
# Folders added by hand, kept beside the presets so they reach the other Mac too. A saved folder that
# isn't on this Mac is left out of the list, the same way a missing iCloud folder is.
FOLDERS_FILE = (ICLOUD_DRIVE / "NextDraw Studio" / "folders.json") if ICLOUD_DRIVE.is_dir() else (ROOT / "folders.json")


def saved_folders():
    """The folders added by hand, in the order they were added. Unreadable file means none."""
    try:
        raw = json.loads(FOLDERS_FILE.read_text())
    except (OSError, ValueError):
        return []
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, str):
            continue
        try:
            path = Path(os.path.expanduser(item)).resolve()
        except (OSError, RuntimeError, ValueError):
            continue
        if path not in out:
            out.append(path)
    return out


def write_saved_folders(paths):
    FOLDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    FOLDERS_FILE.write_text(json.dumps([str(p) for p in paths], indent=2) + "\n")


def folder_names():
    """Every folder drawings may be opened from, with the name the browser shows, built-ins first."""
    names = {path: name for path, name in BUILT_IN_FOLDERS.items() if path.is_dir()}
    for path in saved_folders():
        if path.is_dir() and path not in names:
            names[path] = path.name or str(path)
    return names or {Path.home(): "Home"}  # never leave the browser with nowhere to look


def allowed_folders():
    return list(folder_names())


# Where Studio writes a new drawing: the shared iCloud folder when there is one, so it syncs to the
# other Mac like every other drawing, and otherwise whichever folder the browser lists first.
DRAWINGS_FOLDER = ICLOUD_DRAWINGS if ICLOUD_DRAWINGS.is_dir() else next(iter(BUILT_IN_FOLDERS))

# A stopped plot's progress: the NextDraw software writes where it stopped into its output SVG,
# which is what its res_plot mode resumes from. The JSON keeps what this app needs to resume it.
RESUME_SVG = JOBS / "resume.svg"
RESUME_META = JOBS / "resume.json"
# The pen-down paths of the plot in progress, in the order they're drawn, for showing what's left.
PLOT_PATHS = JOBS / "plot-paths.svg"
# A line for every plot started and how it ended: the drawing, the layers, the tool and the pen heights
# the plotter was actually given. Plot's heights come from a preset shared between Macs, so this is
# the record of what each plot really used when one draws differently from the one before it.
PLOT_HISTORY = JOBS / "plot-history.log"

PRINTED_FILE = JOBS / "printed-layers.json"

LOCAL_QUEUE_FILE = JOBS / "queue.json"
QUEUE_FILE = (ICLOUD_DRIVE / "NextDraw Studio" / "queue.json") if ICLOUD_DRIVE.is_dir() else LOCAL_QUEUE_FILE


# The drawing files this app can open besides SVG, by suffix. The table that maps each to the
# importer that reads it lives in server.py, where those live; everything else only ever asks
# whether a file is one of these.
IMPORT_SUFFIXES = (".ai", ".vectorcraft")
DRAWING_SUFFIXES = (".svg", *IMPORT_SUFFIXES)


def write_atomic(path, data, like=None):
    """
    Write a file in one step: fill a temp file beside it, then rename it over the top. A reader sees
    the file as it was or as it now is, never half of either, and a write that fails partway leaves
    the old one untouched.

    The temp file's name is this write's alone. One fixed name per target looked safe and wasn't:
    two pages auto-saving the open drawing at the same moment both wrote jobs/current.tmp, the first
    rename carried it off, and the second died with FileNotFoundError - losing that save and taking
    the request with it (Tom, 2026-11-24). mkstemp settles the name in the one step that can't race.

    `data` is bytes or text. `like` is a file to take the permissions from, for a write over one that
    has its own; without it the mode is the ordinary 0644 rather than mkstemp's private 0600.
    """
    path = Path(path)
    fd, name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(name)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data if isinstance(data, bytes) else data.encode("utf-8"))
        source = like if like is not None else (path if path.exists() else None)
        if source is not None:
            shutil.copymode(source, tmp)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)  # never leave half a file lying beside the real one
        raise
