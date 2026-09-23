"""
NextDraw Plot: a local web GUI for the Bantam Tools NextDraw Python API.

Run:  .venv/bin/python server.py
Then open http://127.0.0.1:5055

Add --lan to also serve the page to phones, tablets and other computers on the same network.
"""

import copy
import inspect
import hashlib
import json
import logging
import math
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import warnings
import webbrowser
from pathlib import Path

warnings.filterwarnings("ignore", module="urllib3")

from flask import Flask, jsonify, request, send_from_directory  # noqa: E402
from nextdraw import NextDraw  # noqa: E402
from nextdrawcore import homing, serial_utils  # noqa: E402
from nextdrawcore import nextdraw as nextdraw_core  # noqa: E402
from nextdrawcore.nextdraw_options import models  # noqa: E402
from nextdrawcore import nextdraw_conf  # noqa: E402
from plotink import ebb_serial  # noqa: E402

HOST, PORT = "127.0.0.1", 5055
ROOT = Path(__file__).parent
JOBS = ROOT / "jobs"
JOBS.mkdir(exist_ok=True)
CURRENT_SVG = JOBS / "current.svg"
CURRENT_MTIME = JOBS / "current.mtime"  # the file's modified time when opened or last saved, to catch outside edits
CURRENT_OPENED = JOBS / "current.opened"  # changes each time a drawing is opened, by anyone
CURRENT_HASH = JOBS / "current.hash"  # and a hash of its bytes, so the page can be told it changed
CURRENT_PATH = JOBS / "current.path"  # where the loaded drawing lives on disk; absent for uploaded copies


ILLUSTRATOR_POINTS_PER_INCH = 72.0
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
MAX_STUDIO_SVG = 20 * 1024 * 1024  # generous: hatch fills will make these big
# What "Trim to drawing" leaves around the drawing, in inches. Small enough to be invisible on
# paper and to cost nothing in placement; large enough that nothing sits on the page's edge.
TRIM_MARGIN_IN = 0.01
# A stopped plot's progress: the NextDraw software writes where it stopped into its output SVG,
# which is what its res_plot mode resumes from. The JSON keeps what this app needs to resume it.
RESUME_SVG = JOBS / "resume.svg"
RESUME_META = JOBS / "resume.json"
# The pen-down paths of the plot in progress, in the order they're drawn, for showing what's left.
PLOT_PATHS = JOBS / "plot-paths.svg"

# Settings the GUI may change, with (min, max) limits from the NextDraw docs.
NUMERIC_SETTINGS = {
    "model": (1, 10),
    "handling": (1, 4),
    "speed_pendown": (1, 100),
    "speed_penup": (1, 100),
    "accel": (1, 100),
    "pen_pos_down": (0, 100),
    "pen_pos_up": (0, 100),
    "pen_setup": (0, 100),  # App-only: holder height for mounting a pen with the sizing block
    "pen_rate_lower": (1, 100),
    "pen_rate_raise": (1, 100),
    "copies": (1, 100),
    "page_delay": (0, 3600),
    "reordering": (0, 4),
}
BOOL_SETTINGS = {"auto_rotate", "random_start", "hiding", "drag_only", "ink_builds"}
# App-only settings with fractional values: the pen's line width in mm, for drawing the preview.
# join_gap is the NextDraw software's own path joining: two path ends closer than this are drawn as
# one stroke instead of two, saving the lift between them. It is kept in mm like every other length
# the operator sees, and handed to the software in inches as params.min_gap (its default is 0.006 in,
# 0.15 mm). Zero joins only ends that meet exactly.
FLOAT_SETTINGS = {"pen_width": (0.05, 10.0), "ink_opacity": (0.05, 1.0), "ink_build": (0.0, 1.0),
                  "join_gap": (0.0, 5.0)}
# Not NextDraw options: either the app's own, or set somewhere other than nd.options (join_gap).
APP_ONLY_SETTINGS = {"pen_setup", "pen_width", "ink_opacity", "ink_builds", "ink_build", "drag_only", "join_gap"}

# What a pen preset remembers (ink_opacity is how much the paper shows through a stroke, and
# ink_builds whether more of the same ink darkens what's already there, and ink_build how much a
# second pass adds when it does, all for the preview).
# Paper size is chosen separately and isn't part of a preset.
PRESET_NUMERIC = {
    "pen_pos_down", "pen_pos_up", "pen_setup", "pen_rate_lower", "pen_rate_raise",
    "speed_pendown", "speed_penup", "accel", "handling", "pen_width", "ink_opacity", "ink_builds", "ink_build",
    "join_gap",
}

# Walk commands in the NextDraw software don't check the carriage's range of motion.
# We clamp each walk by wrapping HomingClass.adjust_origin_offset, which utility_command()
# calls after homing and before moving. If a future NextDraw release changes that, refuse to walk.
WALK_CLAMP_SUPPORTED = "adjust_origin_offset" in inspect.getsource(nextdraw_core.NextDraw.utility_command)
MANUAL_COMMANDS = {"raise_pen", "lower_pen", "pen_setup", "pen_test", "walk", "home", "release", "read"}

ERRORS = {
    101: "Couldn't connect to the plotter. Check that it's plugged in by USB and switched on.",
    102: "Paused with the button on the plotter.",
    103: "Stopped. The pen was raised where the plot paused.",
    104: "Lost the USB connection to the plotter during the plot.",
    105: "The plotter lost power during the plot.",
    106: "Homing failed. Check that nothing is blocking the carriage.",
}

mimetypes.add_type("application/manifest+json", ".webmanifest")  # the page's Add to Home Screen details

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024


@app.after_request
def no_stale_api(response):
    """The app's data changes under the page (presets, status, drawings): never let a browser reuse an old answer."""
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# Layers that finished plotting since the drawing was loaded (ids). In memory only: "printed this
# session" clears when another drawing is opened or the app restarts.
printed_layers = set()
printed_lock = threading.Lock()

# Whether the last plot ended by being stopped. A stop leaves the motors on and the step count
# true, so going home from there is a straight walk back - not the homing sweep, which exists for a
# position that can't be trusted (see find_home_first). Cleared by any plot that isn't stopped.
last_plot_stopped = False


def forget_printed():
    with printed_lock:
        printed_layers.clear()


def mark_printed(layer_ids):
    """Record a plot that ran to the end: its layers (one, or several linked to print together), or
    every shown layer when the whole drawing plotted."""
    try:
        root = parse_svg(CURRENT_SVG).getroot()
        ids = list(layer_ids) if layer_ids else [g.get("id") for g in layer_groups(root) if g.get("id") and not layer_hidden(g)]
    except Exception:  # noqa: BLE001 - a missing mark is not worth failing a finished plot over
        return
    with printed_lock:
        printed_layers.update(i for i in ids if i)


class Job:
    """Shared state for the one plot or pen test that can run at a time."""

    def __init__(self):
        self.lock = threading.Lock()
        self.nd = None
        self.thread = None
        self.reset("idle")

    def reset(self, state):
        self.state = state          # idle | preparing | plotting | stopping | finished | stopped | error | testing
        self.message = ""
        self.done_mm = 0.0
        self.total_mm = 0.0
        self.estimate_s = 0.0
        self.speed_pct = 100        # live speed adjustment for this plot (see set_speed)
        self.plot_settings = {}     # the running plot's settings at 100%
        self.started = None
        self.ended = None
        self.log = []

    def busy(self):
        return self.state in ("preparing", "plotting", "stopping", "returning", "testing", "moving")

    def snapshot(self):
        done = self.done_mm
        if self.nd is not None and self.state in ("plotting", "stopping"):  # live progress
            # Pen-down distance: it's what the NextDraw software records as a plot's progress, and a
            # resumed plot starts counting from where the stopped one left off.
            stats = self.nd.plot_status.stats
            inches = stats.down_travel_tot + stats.down_travel_inch
            # max(): a resumed plot's counter only picks up its starting point once plotting begins.
            done = max(self.done_mm, inches * 25.4)
            done = min(done, self.total_mm) if self.total_mm else done
            self.done_mm = done
        end = self.ended or time.time()
        return {
            "state": self.state,
            "message": self.message,
            "done_mm": round(done, 1),
            "total_mm": round(self.total_mm, 1),
            "estimate_s": round(self.estimate_s),
            "speed_pct": self.speed_pct,
            "elapsed_s": round(end - self.started) if self.started else 0,
            "started": self.started is not None,
            "log": self.log[-20:],
        }


job = Job()

# Last known carriage state, in mm from the plotter's home corner.
carriage = {
    "known": False,     # True when x/y below were read from the plotter
    "x": 0.0, "y": 0.0,
    "origin_known": False,
    "origin_x": 0.0,    # Plot-start offset stored in the plotter (set just before each plot)
    "origin_y": 0.0,
    "pen_up": None,
    "motors_on": None,
    "verified": False,  # Homed by this app since it started (or since the carriage was released)
}


def clean_settings(raw):
    settings = {}
    for key, (low, high) in NUMERIC_SETTINGS.items():
        if key in raw:
            try:
                settings[key] = max(low, min(high, int(float(raw[key]))))
            except (TypeError, ValueError):
                pass
    for key, (low, high) in FLOAT_SETTINGS.items():
        if key in raw:
            try:
                settings[key] = round(max(low, min(high, float(raw[key]))), 3)
            except (TypeError, ValueError):
                pass
    for key in BOOL_SETTINGS:
        if key in raw:
            settings[key] = bool(raw[key])
    # Drawings plot in the orientation they were drawn; the operator turns them with the rotate
    # buttons. NextDraw's own automatic sideways turn is always off.
    settings["auto_rotate"] = False
    return settings


def clean_scale(raw):
    """Drawing scale in percent (1-1000), default 100."""
    try:
        return max(1.0, min(1000.0, float(raw.get("scale", 100))))
    except (TypeError, ValueError):
        return 100.0


# Length units the SVG spec allows on width/height, in CSS px (user units when there's no viewBox).
PX_PER_UNIT = {"": 1.0, "px": 1.0, "in": 96.0, "mm": 96 / 25.4, "cm": 96 / 2.54, "pt": 96 / 72, "pc": 16.0}


def is_illustrator_svg(root):
    """Illustrator marks its SVG exports with a 'Generator: Adobe Illustrator' comment."""
    from lxml import etree
    for node in root.iter(etree.Comment):
        if "Adobe Illustrator" in (node.text or ""):
            return True
    parent = root.getprevious()
    while parent is not None:  # comments before <svg>
        if isinstance(parent, etree._Comment) and "Adobe Illustrator" in (parent.text or ""):
            return True
        parent = parent.getprevious()
    return False


SVG_NS = "{http://www.w3.org/2000/svg}"
INKSCAPE_NS = "{http://www.inkscape.org/namespaces/inkscape}"
ILLUSTRATOR_ID_TAIL = re.compile(r"_\d{8,}_$")  # Illustrator's suffix when a name is used twice
ILLUSTRATOR_ID_ESCAPE = re.compile(r"_x([0-9A-Fa-f]{2,4})_")  # Illustrator's escape for characters ids can't hold


def layer_name(group, illustrator):
    label = group.get(INKSCAPE_NS + "label") or group.get("data-name")
    if label:
        return label
    name = group.get("id") or ""
    if name.startswith("nds-layer-"):
        return ""
    if illustrator:
        name = ILLUSTRATOR_ID_TAIL.sub("", name)
        name = ILLUSTRATOR_ID_ESCAPE.sub(lambda m: chr(int(m.group(1), 16)), name)
        name = name.replace("_", " ")
    return name.strip()


def class_strokes(root):
    """Stroke colors set by class in <style> blocks, e.g. .st0{stroke:#912474}."""
    strokes = {}
    for style in root.iter(SVG_NS + "style"):
        for selectors, body in re.findall(r"([^{}]+)\{([^}]*)\}", style.text or ""):
            match = re.search(r"(?:^|;)\s*stroke\s*:\s*([^;]+)", body)
            if not match:
                continue
            for selector in selectors.split(","):
                selector = selector.strip()
                if selector.startswith("."):
                    strokes[selector[1:]] = match.group(1).strip()
    return strokes


def stroke_of(node, by_class):
    match = re.search(r"(?:^|;)\s*stroke\s*:\s*([^;]+)", node.get("style") or "")
    if match:
        return match.group(1).strip()
    if node.get("stroke"):
        return node.get("stroke").strip()
    for cls in (node.get("class") or "").split():
        if cls in by_class:
            return by_class[cls]
    return None


SHAPE_TAGS = {SVG_NS + t for t in ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon")}


def read_layers(root):
    """The drawing's layers, top to bottom as they appear in the file: Inkscape layers if the file has them,
    otherwise the top-level groups (which is how Illustrator writes its layers)."""
    illustrator = is_illustrator_svg(root)
    groups = layer_groups(root)
    by_class = class_strokes(root)
    fills = studio_fills(root)
    layers = []
    for index, group in enumerate(groups):
        counts = {}
        shapes = 0
        for node in group.iter():
            if node.tag not in SHAPE_TAGS:
                continue
            shapes += 1
            color = None
            walk = node
            while walk is not None and color is None:  # stroke can be inherited from a parent group
                color = stroke_of(walk, by_class)
                walk = walk.getparent() if walk is not group else None
            if color and color.lower() != "none":
                counts[color.lower()] = counts.get(color.lower(), 0) + 1
        colors = sorted(counts, key=counts.get, reverse=True)
        name = layer_name(group, illustrator)
        layers.append({
            "index": index,
            "id": group.get("id"),
            "name": name or f"Layer {index + 1}",
            "color": colors[0] if colors else None,
            "colors": colors,
            "shapes": shapes,
            "skipped": name.startswith("%"),  # NextDraw doesn't plot layers whose names start with %
            "hidden": layer_hidden(group),  # hidden in Illustrator/Inkscape or in the app; not plotted
            "fill_spacing": fill_spacing_of(group, fills),  # mm: Studio's hatch spacing here, or None
        })
    return layers


HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
STROKE_RULE = re.compile(r"(?:^|;)\s*stroke\s*:[^;]*")


def has_art(group):
    """Whether a group holds anything that can be drawn. Illustrator exports can carry empty groups."""
    return any(el.tag in SHAPE_TAGS or el.tag == SVG_NS + "use" for el in group.iter())


def layer_groups(root):
    """The elements read_layers reports, in file order: Inkscape layers if there are any, otherwise the
    top-level groups. Groups with nothing to draw in them aren't layers."""
    groups = [g for g in root if g.tag == SVG_NS + "g" and g.get(INKSCAPE_NS + "groupmode") == "layer"]
    groups = groups or [g for g in root if g.tag == SVG_NS + "g"]
    return [g for g in groups if has_art(g)]


AUTO_LAYER_ID = "nds-layer-"  # ids the app gives unnamed layers; never shown as a name
PLOT_NS = "https://github.com/tomcog/NextDraw"
PLOT_TAG = "{%s}plot" % PLOT_NS
# Drawings saved before the app was renamed carry the same block under the old element name. They're
# read as they are and rewritten as <nds:plot> the next time the drawing is saved.
LEGACY_PLOT_TAG = "{%s}studio" % PLOT_NS
PLOT_METADATA_ID = "nextdraw-plot"


def parse_svg(path):
    from lxml import etree
    return etree.parse(str(path), etree.XMLParser(huge_tree=True, remove_blank_text=False))


def svg_bytes(tree):
    from lxml import etree
    return etree.tostring(tree, xml_declaration=True, encoding=tree.docinfo.encoding or "utf-8")


def ensure_layer_ids(path):
    """Give every layer an id, so the page can refer to layers while they're renamed and reordered."""
    tree = parse_svg(path)
    root = tree.getroot()
    used = {el.get("id") for el in root.iter() if el.get("id")}
    changed = False
    for n, group in enumerate(layer_groups(root), start=1):
        if group.get("id"):
            continue
        candidate = f"{AUTO_LAYER_ID}{n}"
        while candidate in used:
            candidate += "_"
        group.set("id", candidate)
        used.add(candidate)
        changed = True
    if changed:
        path.write_bytes(svg_bytes(tree))


def read_plot(root):
    """
    The page's saved choices for this drawing (placement, scale, tool, paper), or None. A block in
    the current name wins outright: if one is there but unreadable the answer is None, rather than
    quietly falling back to whatever an older save left behind.
    """
    for tag in (PLOT_TAG, LEGACY_PLOT_TAG):
        for node in root.iter(tag):
            try:
                data = json.loads(node.text or "{}")
                return data if isinstance(data, dict) else None
            except ValueError:
                return None
    return None


def write_plot(root, data):
    """Write the block under the current name, taking out any older one so a drawing never has both."""
    from lxml import etree
    for tag in (PLOT_TAG, LEGACY_PLOT_TAG):
        for node in list(root.iter(tag)):
            parent = node.getparent()
            parent.remove(node)
            if parent.tag == SVG_NS + "metadata" and len(parent) == 0 and not (parent.text or "").strip():
                parent.getparent().remove(parent)
    metadata = etree.Element(SVG_NS + "metadata")
    metadata.set("id", PLOT_METADATA_ID)
    node = etree.SubElement(metadata, PLOT_TAG, nsmap={"nds": PLOT_NS})
    node.text = json.dumps(data, separators=(",", ":"))
    metadata.tail = "\n"
    root.insert(0, metadata)


def normalize_size(root):
    """
    Give the document a width and height the NextDraw software can size, in inches, when it lacks
    one it understands. Illustrator writes coordinates in points (72 per inch) and, with its default
    "Responsive" export, no width/height at all; the SVG standard assumes 96 per inch.
    Returns a note for the user, or None.
    """
    def length(value):
        m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$", value or "", re.I)
        return (float(m.group(1)), m.group(2).lower()) if m else None

    illustrator = is_illustrator_svg(root)
    per_inch = ILLUSTRATOR_POINTS_PER_INCH if illustrator else 96.0
    width, height = length(root.get("width")), length(root.get("height"))
    vb = root.get("viewBox")
    vb = [float(v) for v in re.split(r"[\s,]+", vb.strip())] if vb else None

    note = None
    if not (width and height) or width[1] == "%" or height[1] == "%":
        if not vb:
            return None  # nothing to size from; the software reports it
        root.set("width", f"{vb[2] / per_inch:g}in")
        root.set("height", f"{vb[3] / per_inch:g}in")
        if illustrator:
            note = ("This Illustrator SVG was saved without a page size (Responsive on), so the page is "
                    "sized from its coordinates. If the artboard wasn't included, the page is just the "
                    "artwork's outline.")
    elif illustrator and width[1] in ("", "px") and height[1] in ("", "px"):
        # Illustrator's "px" are points.
        if not vb:
            root.set("viewBox", f"0 0 {width[0]:g} {height[0]:g}")
        root.set("width", f"{width[0] / per_inch:g}in")
        root.set("height", f"{height[0] / per_inch:g}in")
    return note


DISPLAY_RULE = re.compile(r"(?:^|;)\s*display\s*:\s*([^;]*)")


def layer_hidden(group):
    style = DISPLAY_RULE.search(group.get("style") or "")
    return (style and style.group(1).strip() == "none") or group.get("display") == "none" \
        or group.get("visibility") in ("hidden", "collapse")


def set_layer_hidden(group, hidden):
    style = DISPLAY_RULE.sub("", group.get("style") or "").strip(" ;")
    group.attrib.pop("display", None)
    if group.get("visibility") in ("hidden", "collapse"):
        group.attrib.pop("visibility")
    if hidden:
        group.set("style", f"{style};display:none" if style else "display:none")
    elif style:
        group.set("style", style)
    else:
        group.attrib.pop("style", None)


def only_layers(root, layer_ids):
    """Hide every layer but the ones to print, so the NextDraw software plots just those (it skips
    display:none). Several are layers linked to print together: the same pen, so one pass draws them all.
    The hidden layers stay in the document, so the page size and the preview's layer ids don't change."""
    groups = layer_groups(root)
    targets = [g for g in groups if g.get("id") in layer_ids]
    if len(targets) != len(set(layer_ids)):
        raise RuntimeError("The layer chosen to print isn't in the drawing anymore. Choose it again.")
    if any(layer_hidden(g) for g in targets):
        raise RuntimeError("The layer chosen to print is hidden. Show it to plot it.")
    for group in groups:
        if group not in targets:
            set_layer_hidden(group, True)


def clean_layers(raw):
    """The layers to plot, by id: `layers` (a list, for layers linked to print together) or the older
    single `layer`. None plots the whole drawing."""
    ids = raw.get("layers")
    if not isinstance(ids, list):
        ids = [raw.get("layer")]
    ids = list(dict.fromkeys(str(i)[:200] for i in ids if isinstance(i, str) and i))[:500]
    return ids or None


def clean_rotation(raw):
    """Quarter turns clockwise: 0, 90, 180 or 270."""
    try:
        return int(round(float(raw.get("rotation", 0)) / 90)) % 4 * 90
    except (TypeError, ValueError):
        return 0


NON_DRAWING_TAGS = {SVG_NS + t for t in ("defs", "style", "metadata", "title", "desc")}


def rotate_document(root, rotation):
    """Turn the whole drawing clockwise by a quarter turn (or two, or three), page and all. Each top-level
    element gets the turn prepended to its own transform, rather than being wrapped in a new group, so
    the layers stay top-level and keep working for plotting and the preview."""
    if not rotation:
        return
    def length(value):
        m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$", value or "", re.I)
        return (float(m.group(1)), m.group(2).lower()) if m else None
    width, height = length(root.get("width")), length(root.get("height"))
    if not root.get("viewBox"):
        if not (width and height and width[1] in PX_PER_UNIT and height[1] in PX_PER_UNIT):
            raise RuntimeError("This SVG has no size the drawing can be turned from.")
        root.set("viewBox", f"0 0 {width[0] * PX_PER_UNIT[width[1]]:g} {height[0] * PX_PER_UNIT[height[1]]:g}")
    vx, vy, vw, vh = [float(v) for v in re.split(r"[\s,]+", root.get("viewBox").strip())]
    matrix = {
        90: (0, 1, -1, 0, vy + vh, -vx),
        180: (-1, 0, 0, -1, vx + vw, vy + vh),
        270: (0, -1, 1, 0, -vy, vx + vw),
    }[rotation]
    turn = "matrix(%s)" % " ".join(f"{v:g}" for v in matrix)
    for child in root:
        if not isinstance(child.tag, str) or child.tag in NON_DRAWING_TAGS:
            continue
        child.set("transform", f"{turn} {child.get('transform')}" if child.get("transform") else turn)
    if rotation in (90, 270):
        root.set("viewBox", f"0 0 {vh:g} {vw:g}")
        if root.get("width") and root.get("height"):
            w, h = root.get("width"), root.get("height")
            root.set("width", h)
            root.set("height", w)
    else:
        root.set("viewBox", f"0 0 {vw:g} {vh:g}")


# Studio's hatch fills, regenerated at plot time. Studio writes each fill twice: as the lines it drew,
# in a group whose id is STUDIO_FILL_PREFIX + the fill's id, and as the parameters that made them, in
# its <nds:design> block. Plot never edits the drawing, but it may plot the fill differently: at a
# spacing found to suit the ink better (chosen per layer while plotting, kept in Plot's own block), or
# at a scale other than the one the lines were made for. Either way the lines are made again here, in
# the copy sent to the plotter and the preview, from the same parameters - the file is untouched.
#
# The geometry is a port of web/src/studio/lib/hatch.ts (hatchLines and hatchStroke) and has to stay
# in step with it: tests/hatch_matches_studio.py compares the two.
STUDIO_FILL_PREFIX = "studio-fill-"
DESIGN_TAG = "{%s}design" % PLOT_NS


def studio_fills(root):
    """Studio's fills by id, from its design block; empty for a drawing Studio didn't make."""
    for node in root.iter(DESIGN_TAG):
        try:
            data = json.loads(node.text or "{}")
        except ValueError:
            return {}
        fills = data.get("fills") if isinstance(data, dict) else None
        return {f["id"]: f for f in fills or [] if isinstance(f, dict) and isinstance(f.get("id"), str)}
    return {}


def fill_spacing_of(group, fills):
    """The spacing (mm) Studio gave the fills on a layer - the first one's - or None if it has none."""
    for g in group.iter(SVG_NS + "g"):
        fill = fills.get((g.get("id") or "")[len(STUDIO_FILL_PREFIX):]) if (g.get("id") or "").startswith(STUDIO_FILL_PREFIX) else None
        if fill:
            try:
                return float(fill.get("spacing_mm"))
            except (TypeError, ValueError):
                return None
    return None


def inset_box(box, by):
    """insetBox: a box brought in by the same distance on every side, never past its own middle."""
    x0, y0, x1, y1 = box
    if by <= 0:
        return box
    x = min(by, (x1 - x0) / 2)
    y = min(by, (y1 - y0) / 2)
    return (x0 + x, y0 + y, x1 - x, y1 - y)


def inset_outline(outline, box, by):
    """insetOutlines: an outline brought inward the way the concentric rings are."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if by <= 0 or w <= 1e-9 or h <= 1e-9 or not outline:
        return outline
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    kx = max(0.0, (w - 2 * by) / w)
    ky = max(0.0, (h - 2 * by) / h)
    return [(cx + (px - cx) * kx, cy + (py - cy) * ky) for px, py in outline]


def hatch_lines(kind, box, angle, step, outline=None, inset=0):
    """hatchLines: the lines across a rect or ellipse box (x0, y0, x1, y1), `step` apart, swept out
    from the middle. Each is (x1, y1, x2, y2), running in the direction of the angle. A "polygon"
    is clipped to `outline` - the shape's own points - rather than to the box around it.
    `inset` brings the region the lines are cut to inward all round, which is what keeps a wave's
    crests inside the shape instead of across its outline."""
    whole = box
    box = inset_box(box, inset)
    outline = inset_outline(outline, whole, inset)
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0 or not step > 0.002:
        return []
    rad = angle * math.pi / 180
    dx, dy = math.cos(rad), math.sin(rad)
    nx, ny = -dy, dx
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    reach = math.hypot(w, h) / 2

    def clip_box(px, py):
        lo, hi = -math.inf, math.inf
        for p, d, mn, mx in ((px, dx, x0, x1), (py, dy, y0, y1)):
            if abs(d) < 1e-12:
                if not mn <= p <= mx:
                    return None
                continue
            a, z = (mn - p) / d, (mx - p) / d
            if a > z:
                a, z = z, a
            lo, hi = max(lo, a), min(hi, z)
        return None if hi <= lo else (px + dx * lo, py + dy * lo, px + dx * hi, py + dy * hi)

    def clip_ellipse(px, py):
        rx, ry = w / 2, h / 2
        ox, oy, ux, uy = (px - cx) / rx, (py - cy) / ry, dx / rx, dy / ry
        a = ux * ux + uy * uy
        b = 2 * (ox * ux + oy * uy)
        c = ox * ox + oy * oy - 1
        disc = b * b - 4 * a * c
        if a <= 0 or disc <= 0:
            return None
        root = math.sqrt(disc)
        lo, hi = (-b - root) / (2 * a), (-b + root) / (2 * a)
        return (px + dx * lo, py + dy * lo, px + dx * hi, py + dy * hi)

    def clip_outline(px, py):
        """Every span of the line that lies inside the outline, counting crossings the even-odd way."""
        hits = []
        for (ax, ay), (bx, by) in zip(outline, outline[1:]):
            ex, ey = bx - ax, by - ay
            denom = dx * ey - dy * ex
            if abs(denom) < 1e-12:
                continue
            u = (dx * (ay - py) - dy * (ax - px)) / -denom
            t = (ex * (ay - py) - ey * (ax - px)) / -denom
            if 0 <= u < 1:  # half-open, so a crossing on a corner counts once
                hits.append(t)
        hits.sort()
        return [(px + dx * a, py + dy * a, px + dx * b, py + dy * b)
                for a, b in zip(hits[0::2], hits[1::2])]

    lines = []
    n = math.ceil(reach / step)
    for i in range(-n, n + 1):
        t = i * step
        px, py = cx + nx * t, cy + ny * t
        if kind == "polygon":
            if not outline or len(outline) < 3:
                continue
            for seg in clip_outline(px, py):
                if math.hypot(seg[2] - seg[0], seg[3] - seg[1]) > 1e-6:
                    lines.append(seg)
            continue
        seg = (clip_box if kind == "rect" else clip_ellipse)(px, py)
        if seg and math.hypot(seg[2] - seg[0], seg[3] - seg[1]) > 1e-6:
            lines.append(seg)
    return lines


def waved(seg, wave, swing):
    """waved: a straight span drawn as a wave, a point every few degrees across the line.

    The wave is counted from where the line itself starts rather than from where the shape cuts it,
    the way the dashes are, so every line in a fill crests together and the waves stand in straight
    rows across it.
    """
    x1, y1, x2, y2 = seg
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length < 1e-9 or wave <= 0:
        return [(x1, y1), (x2, y2)]
    ux, uy = dx / length, dy / length
    frm = x1 * ux + y1 * uy
    steps = max(2, min(400, math.ceil((length / wave) * 12)))
    out = []
    for i in range(steps + 1):
        t = (i / steps) * length
        swing_at = swing * math.sin(2 * math.pi * (frm + t) / wave)
        out.append((x1 + ux * t - uy * swing_at, y1 + uy * t + ux * swing_at))
    return out


def dashed(seg, dash, gap):
    """dashed: a straight span broken into strokes, `dash` long and `gap` apart, measured from where
    the line starts rather than from where the shape cuts it - so the dashes stand in straight rows."""
    x1, y1, x2, y2 = seg
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    step = dash + gap
    if length < 1e-9 or dash <= 0 or step <= 0:
        return [seg]
    ux, uy = dx / length, dy / length
    start_at = x1 * ux + y1 * uy
    out = []
    at = -(((start_at % step) + step) % step)
    while at < length - 1e-9 and len(out) < 2000:
        begin, end = max(at, 0.0), min(at + dash, length)
        if end > begin + 1e-9:
            out.append((x1 + ux * begin, y1 + uy * begin, x1 + ux * end, y1 + uy * end))
        at += step
    return out


def concentric_runs(outlines, box, step):
    """concentricRuns: the outline stepped inward, every edge brought in by the same distance."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    runs = []
    for i in range(2000):
        inset = i * step
        kx = (w - 2 * inset) / w if w > 1e-9 else 0
        ky = (h - 2 * inset) / h if h > 1e-9 else 0
        if kx <= 0.01 or ky <= 0.01:
            break
        for outline in outlines:
            runs.append([(cx + (px - cx) * kx, cy + (py - cy) * ky) for px, py in outline])
    return runs


def closed_outlines(kind, box, outline):
    """The outlines a concentric fill steps inward from: a curve's own points, or the box's edges."""
    if kind == "polygon" and outline:
        return [list(outline)]
    x0, y0, x1, y1 = box
    if kind == "rect":
        return [[(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]]
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    steps = 72
    rim = [(cx + rx * math.cos(-math.pi / 2 + 2 * math.pi * i / steps),
            cy + ry * math.sin(-math.pi / 2 + 2 * math.pi * i / steps)) for i in range(steps)]
    return [rim + [rim[0]]]  # closed on the point it started from, exactly


def fill_runs(kind, box, fill, step, outline=None):
    """fillRuns: everything a fill draws, as runs of points - one run per stroke the pen makes."""
    what = fill.get("kind") or "hatch"
    inches = lambda mm: float(mm) / 25.4 / (float(fill.get("scale") or 100) / 100)  # noqa: E731
    if what == "concentric":
        return concentric_runs(closed_outlines(kind, box, outline), box, step)
    angle = float(fill.get("angle") or 0)
    if what == "wavy":
        wave = inches(fill.get("wave_mm", 6))
        # Kept in step with defaultSwingMm in hatch.ts: a swing nobody set is a fraction of the
        # spacing, so the waves stay between their neighbours whatever pen the spacing came from.
        # Taken from `step` rather than from the fill's own spacing because that is the spacing the
        # lines are actually being drawn at - the tool's, when Plot is regenerating at its own.
        swing = (inches(fill["swing_mm"]) if fill.get("swing_mm") is not None
                 else inches(round(step * 25.4 * float(fill.get("scale") or 100) / 100 * 0.4, 2)))
        # Cut to a shape brought in by the swing, so the crests land on the outline, not across it.
        return [waved(seg, wave, swing) for seg in hatch_lines(kind, box, angle, step, outline, swing)]
    lines = hatch_lines(kind, box, angle, step, outline)
    if what == "dashes":
        dash = inches(fill.get("dash_mm", 3))
        gap = inches(fill.get("gap_mm", 2))
        return [[(d[0], d[1]), (d[2], d[3])] for seg in lines for d in dashed(seg, dash, gap)]
    if fill.get("connected"):
        stroke = hatch_stroke(kind, box, lines, outline)
        return [stroke] if len(stroke) > 1 else []
    return [[(x1, y1), (x2, y2)] for x1, y1, x2, y2 in lines]


def hatch_stroke(kind, box, lines, outline=None):
    """hatchStroke: the lines as one zigzag, each end joined to the next line's start along the
    shape's edge - by the corner of a rect, along the curve of an ellipse, round the outline itself
    for a polygon. A list of (x, y)."""
    x0, y0, x1, y1 = box
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    eps = 1e-6

    def walk_outline(a, b):
        """Along the shape's own outline, the short way round, so a join never cuts across a notch."""
        if not outline or len(outline) < 3:
            return []
        nearest = lambda p: min(range(len(outline)),  # noqa: E731
                                key=lambda i: (outline[i][0] - p[0]) ** 2 + (outline[i][1] - p[1]) ** 2)
        start, end = nearest(a), nearest(b)
        n = len(outline) - 1  # the last point repeats the first
        forward = (end - start + n) % n
        step_dir = 1 if forward <= n - forward else -1
        count = forward if step_dir == 1 else n - forward
        return [outline[(start + step_dir * k) % n] for k in range(1, count)]

    def join(a, b):
        if kind == "polygon":
            return walk_outline(a, b)
        if kind == "rect":
            side = lambda p: x0 if abs(p[0] - x0) < eps else x1 if abs(p[0] - x1) < eps else None  # noqa: E731
            cap = lambda p: y0 if abs(p[1] - y0) < eps else y1 if abs(p[1] - y1) < eps else None  # noqa: E731
            sf, cf, st, ct = side(a), cap(a), side(b), cap(b)
            if sf is not None and ct is not None and sf != st and cf != ct:
                return [(sf, ct)]
            if cf is not None and st is not None and cf != ct and sf != st:
                return [(st, cf)]
            return []
        a0 = math.atan2((a[1] - cy) / ry, (a[0] - cx) / rx)
        a1 = math.atan2((b[1] - cy) / ry, (b[0] - cx) / rx)
        if a1 - a0 > math.pi:
            a1 -= 2 * math.pi
        if a0 - a1 > math.pi:
            a1 += 2 * math.pi
        n = int(abs(a1 - a0) // (math.pi / 60))
        return [(cx + rx * math.cos(a0 + (a1 - a0) * (k + 1) / (n + 1)),
                 cy + ry * math.sin(a0 + (a1 - a0) * (k + 1) / (n + 1))) for k in range(n)]

    points = []
    for i, (ax, ay, bx, by) in enumerate(lines):
        start, end = ((ax, ay), (bx, by)) if i % 2 == 0 else ((bx, by), (ax, ay))
        if points:
            points.extend(join(points[-1], start))
        points += [start, end]
    return points


# Reading path data, as web/src/studio/lib/path.ts reads it - a port, kept in step by
# tests/plot_walks_a_path_out_as_studio_does.py. Studio keeps a curve as the curve, and writes it back
# as one; to hatch a curved shape here the curve is walked out into points at the same step Studio
# walks it at, so the outline Plot clips to is the outline Studio clipped to.
PATH_TOKENS = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?", re.I)
PATH_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def cubic_points(fr, c1, c2, to, step):
    """cubic: a cubic walked in pieces of about `step`, the first point left to whatever drew it."""
    rough = (math.hypot(c1[0] - fr[0], c1[1] - fr[1]) + math.hypot(c2[0] - c1[0], c2[1] - c1[1])
             + math.hypot(to[0] - c2[0], to[1] - c2[1]))
    steps = max(2, min(200, math.ceil(rough / step)))
    out = []
    for i in range(steps):
        t = (i + 1) / steps
        u = 1 - t
        out.append((u * u * u * fr[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
                    u * u * u * fr[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1]))
    return out


def arc_points(fr, rx, ry, deg, large, sweep, to, step):
    """arc: an elliptical arc as the format describes it, walked out at about `step`."""
    if not rx or not ry:
        return [to]
    rad = deg * math.pi / 180
    cos, sin = math.cos(rad), math.sin(rad)
    dx, dy = (fr[0] - to[0]) / 2, (fr[1] - to[1]) / 2
    x1 = cos * dx + sin * dy
    y1 = -sin * dx + cos * dy
    ax, ay = abs(rx), abs(ry)
    big = (x1 * x1) / (ax * ax) + (y1 * y1) / (ay * ay)
    if big > 1:
        ax *= math.sqrt(big)
        ay *= math.sqrt(big)
    denom = ax * ax * y1 * y1 + ay * ay * x1 * x1
    factor = math.sqrt(max(0.0, (ax * ax * ay * ay - denom) / denom)) * (-1 if large == sweep else 1)
    cx1 = factor * ax * y1 / ay
    cy1 = -factor * ay * x1 / ax
    cx = cos * cx1 - sin * cy1 + (fr[0] + to[0]) / 2
    cy = sin * cx1 + cos * cy1 + (fr[1] + to[1]) / 2
    start = math.atan2((y1 - cy1) / ay, (x1 - cx1) / ax)
    sweep_angle = math.atan2((-y1 - cy1) / ay, (-x1 - cx1) / ax) - start
    if not sweep and sweep_angle > 0:
        sweep_angle -= 2 * math.pi
    if sweep and sweep_angle < 0:
        sweep_angle += 2 * math.pi
    around = abs(sweep_angle) * max(ax, ay)
    steps = max(2, min(400, math.ceil(around / step)))
    out = []
    for i in range(steps):
        a = start + sweep_angle * (i + 1) / steps
        px, py = ax * math.cos(a), ay * math.sin(a)
        out.append((cos * px - sin * py + cx, sin * px + cos * py + cy))
    return out


def flatten_path_data(d, step=0.01):
    """flattenPath: every run of points a path draws, its curves walked out at about `step`."""
    tokens = PATH_TOKENS.findall(d or "")
    runs, run = [], []
    at = (0.0, 0.0)
    start = (0.0, 0.0)
    last_control = None  # for S and T, which reflect the one before
    state = {"command": "", "numbers": []}

    def flush():
        nonlocal run
        if len(run) > 1:
            runs.append(run)
        run = []

    def apply():
        nonlocal run, at, start, last_control
        command = state["command"]
        upper = command.upper()
        rel = command != upper
        take = PATH_ARITY.get(upper, 0)
        numbers = state["numbers"]
        first = True
        while take == 0 or len(numbers) >= take:
            n = numbers[:take]
            del numbers[:take]
            rx = (lambda v: at[0] + v) if rel else (lambda v: v)
            ry = (lambda v: at[1] + v) if rel else (lambda v: v)
            if upper == "M":
                to = (rx(n[0]), ry(n[1]))
                if first:
                    flush()
                    start = to
                    run = [to]
                else:
                    run.append(to)
                at = to
                last_control = None
            elif upper == "L":
                at = (rx(n[0]), ry(n[1]))
                run.append(at)
                last_control = None
            elif upper == "H":
                at = (rx(n[0]), at[1])
                run.append(at)
                last_control = None
            elif upper == "V":
                at = (at[0], ry(n[0]))
                run.append(at)
                last_control = None
            elif upper in ("C", "S"):
                if upper == "C":
                    c1 = (rx(n[0]), ry(n[1]))
                elif last_control:
                    c1 = (2 * at[0] - last_control[0], 2 * at[1] - last_control[1])
                else:
                    c1 = at
                c2 = (rx(n[2]), ry(n[3])) if upper == "C" else (rx(n[0]), ry(n[1]))
                to = (rx(n[4]), ry(n[5])) if upper == "C" else (rx(n[2]), ry(n[3]))
                run.extend(cubic_points(at, c1, c2, to, step))
                last_control = c2
                at = to
            elif upper in ("Q", "T"):
                if upper == "Q":
                    q = (rx(n[0]), ry(n[1]))
                elif last_control:
                    q = (2 * at[0] - last_control[0], 2 * at[1] - last_control[1])
                else:
                    q = at
                to = (rx(n[2]), ry(n[3])) if upper == "Q" else (rx(n[0]), ry(n[1]))
                c1 = (at[0] + (2 / 3) * (q[0] - at[0]), at[1] + (2 / 3) * (q[1] - at[1]))
                c2 = (to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1]))
                run.extend(cubic_points(at, c1, c2, to, step))
                last_control = q
                at = to
            elif upper == "A":
                to = (rx(n[5]), ry(n[6]))
                run.extend(arc_points(at, n[0], n[1], n[2], n[3], n[4], to, step))
                last_control = None
                at = to
            elif upper == "Z":
                run.append(start)
                flush()
                run = [start]
                at = start
                last_control = None
            first = False
            if take == 0:
                break
        state["numbers"] = []

    for token in tokens:
        if PATH_ARITY.get(token.upper()) is not None and len(token) == 1 and token.isalpha():
            if state["command"]:
                apply()
            state["command"] = token
            if token.upper() == "Z":
                apply()
            continue
        state["numbers"].append(float(token))
        if state["command"] and len(state["numbers"]) >= PATH_ARITY.get(state["command"].upper(), 0):
            apply()
    if state["command"]:
        apply()
    flush()
    return runs


def outline_points(el):
    """A Studio shape's own points, as a closed list of (x, y): a polyline's, or a path's with its
    curves walked out as Studio walks them. Empty for anything else, and for a path drawn in more
    than one run, which is not one outline to clip to."""
    if el is None:
        return []
    if el.tag == SVG_NS + "polyline":
        nums = [float(v) for v in re.findall(r"-?\d*\.?\d+(?:e[-+]?\d+)?", el.get("points") or "")]
        pts = list(zip(nums[0::2], nums[1::2]))
    elif el.tag == SVG_NS + "path":
        runs = [r for r in flatten_path_data(el.get("d") or "") if len(r) > 1]
        if len(runs) != 1:
            return []
        pts = list(runs[0])
    else:
        return []
    if len(pts) > 2 and pts[0] != pts[-1]:
        pts.append(pts[0])  # a fill needs a closed outline to count crossings against
    return pts


def shape_box(el):
    """The box a Studio rect, ellipse or curve is drawn in, as (x0, y0, x1, y1), or None."""
    try:
        if el is not None and el.tag in (SVG_NS + "polyline", SVG_NS + "path"):
            pts = outline_points(el)
            if len(pts) < 3:
                return None
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            return min(xs), min(ys), max(xs), max(ys)
        if el.tag == SVG_NS + "rect":
            x, y = float(el.get("x", 0)), float(el.get("y", 0))
            return x, y, x + float(el.get("width")), y + float(el.get("height"))
        if el.tag == SVG_NS + "ellipse":
            cx, cy, rx, ry = (float(el.get(k)) for k in ("cx", "cy", "rx", "ry"))
            return cx - rx, cy - ry, cx + rx, cy + ry
    except (TypeError, ValueError):
        return None
    return None


def regenerate_hatches(root, spacing_by_layer, scale):
    """Make Studio's fills again where Plot plots them differently from the file: a spacing chosen for
    the layer, or a plot scale other than the one the lines were made for (the spacing is what the
    fill should measure on paper, so the lines move closer as the drawing grows)."""
    from lxml import etree
    fills = studio_fills(root)
    if not fills:
        return
    # Curves are polylines, a curved path is path data, and a repeat's copies carry the shape's id
    # with -r2, -r3 after it: the copies are the same geometry moved, so the first of them is the
    # one a fill is made from.
    shapes = {el.get("id"): el
              for el in root.iter(SVG_NS + "rect", SVG_NS + "ellipse", SVG_NS + "polyline", SVG_NS + "path")
              if el.get("id")}
    num = lambda v: f"{v:.4f}".rstrip("0").rstrip(".")  # noqa: E731 - Studio's own rounding
    for layer in layer_groups(root):
        override = spacing_by_layer.get(layer.get("id"))
        for g in list(layer.iter(SVG_NS + "g")):
            gid = g.get("id") or ""
            # A repeated shape's fill groups are numbered after the first one; they share its numbers.
            name = re.sub(r"-r\d+$", "", gid[len(STUDIO_FILL_PREFIX):]) if gid.startswith(STUDIO_FILL_PREFIX) else ""
            fill = fills.get(name)
            shape = shapes.get(fill.get("shape")) if fill else None
            box = shape_box(shape) if shape is not None else None
            if box is None:
                continue
            try:
                made_for = float(fill.get("scale") or 100)
                spacing = float(override if override is not None else fill.get("spacing_mm"))
                angle = float(fill.get("angle") or 0)
            except (TypeError, ValueError):
                continue
            if override is None and abs(made_for - scale) < 1e-9:
                continue  # the file's own lines are already right
            kind = ("rect" if shape.tag == SVG_NS + "rect"
                    else "polygon" if shape.tag in (SVG_NS + "polyline", SVG_NS + "path") else "ellipse")
            outline = outline_points(shape)
            runs = fill_runs(kind, box, {**fill, "angle": angle, "scale": scale},
                             spacing / 25.4 / (scale / 100), outline)
            for child in list(g):
                g.remove(child)
            # A run of two points is a line, as Studio writes it; anything longer is a polyline.
            for run in runs:
                if len(run) == 2:
                    el = etree.SubElement(g, SVG_NS + "line")
                    for k, v in (("x1", run[0][0]), ("y1", run[0][1]), ("x2", run[1][0]), ("y2", run[1][1])):
                        el.set(k, num(v))
                elif len(run) > 2:
                    el = etree.SubElement(g, SVG_NS + "polyline")
                    el.set("points", " ".join(f"{num(x)},{num(y)}" for x, y in run))


def clean_hatch(raw):
    """Hatch spacings chosen in Plot, by layer id, in mm on paper."""
    out = {}
    spacings = raw.get("hatch_spacing")
    if isinstance(spacings, dict):
        for k, v in list(spacings.items())[:500]:
            try:
                out[str(k)[:200]] = round(max(0.1, min(20.0, float(v))), 3)
            except (TypeError, ValueError):
                pass
    return out


def svg_input(scale, layers=None, rotation=0, hatch=None, raise_mm=0.0):
    """
    The loaded SVG for the NextDraw software: sized (see normalize_size) and scaled if needed. The
    software plots a document at its width/height, so scaling multiplies those while a viewBox keeps
    the artwork filling the page. Returns an SVG string (plot_setup accepts a path or a string).
    """
    from lxml import etree
    root = etree.parse(str(CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot()
    normalize_size(root)
    regenerate_hatches(root, hatch or {}, scale)
    if layers:
        only_layers(root, [layers] if isinstance(layers, str) else layers)
    rotate_document(root, rotation)
    if abs(scale - 100) < 1e-9:
        raise_lines(root, raise_mm)
        return etree.tostring(root, encoding="unicode")
    factor = scale / 100

    def length(value):
        m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$", value or "", re.I)
        return (float(m.group(1)), m.group(2).lower()) if m else None

    width, height = length(root.get("width")), length(root.get("height"))
    if width and height and width[1] in PX_PER_UNIT and height[1] in PX_PER_UNIT:
        if not root.get("viewBox"):
            # Without a viewBox, content is in px; pin that so the artwork scales with the page.
            root.set("viewBox", f"0 0 {width[0] * PX_PER_UNIT[width[1]]:g} {height[0] * PX_PER_UNIT[height[1]]:g}")
        root.set("width", f"{width[0] * factor:g}{width[1]}")
        root.set("height", f"{height[0] * factor:g}{height[1]}")
    elif root.get("viewBox"):
        vb = [float(v) for v in re.split(r"[\s,]+", root.get("viewBox").strip())]
        root.set("width", f"{vb[2] * factor:g}px")
        root.set("height", f"{vb[3] * factor:g}px")
    else:
        raise RuntimeError("This SVG has no size the drawing can be scaled from.")
    raise_lines(root, raise_mm)
    return etree.tostring(root, encoding="unicode")


def clean_placement(raw):
    """Where the drawing starts, in mm from home, its scale, and whether to go home afterward."""
    placement = {"x": 0.0, "y": 0.0, "scale": clean_scale(raw), "return_home": bool(raw.get("return_home", True))}
    # Angle compensation: a tilted tool's tip lands this far toward home from the carriage along the
    # width, so the carriage starts that much further out. x/y stay where the tip draws.
    try:
        placement["tip_offset_x"] = max(0.0, min(100.0, float(raw.get("tip_offset_x", 0))))
    except (TypeError, ValueError):
        placement["tip_offset_x"] = 0.0
    # The barrel: the clip centers the pen across its width, so a barrel wider than the one the paper
    # is lined up for puts the tip this far further down the page, and a thinner one puts it higher
    # (negative). REFERENCE_BARREL_MM in the page.
    try:
        placement["tip_offset_y"] = max(-20.0, min(20.0, float(raw.get("tip_offset_y", 0))))
    except (TypeError, ValueError):
        placement["tip_offset_y"] = 0.0
    placement["rotation"] = clean_rotation(raw)
    # The layers to plot, by id; None plots the whole drawing. `layer` is the first of them, which is
    # the one picked in the Layers card - its tool is the one in the holder.
    placement["layers"] = clean_layers(raw)
    placement["layer"] = placement["layers"][0] if placement["layers"] else None
    placement["hatch"] = clean_hatch(raw)
    for key, name in (("x", "start_x"), ("y", "start_y")):
        try:
            placement[key] = max(0.0, min(2000.0, float(raw.get(name, 0))))
        except (TypeError, ValueError):
            pass
    return placement


def make_nextdraw(log):
    """Create a NextDraw instance whose messages go to `log` instead of stdout."""
    def emit(text):
        text = str(text).strip()
        if text:
            log.append(re.sub(r"\s*\n+\s*", " ", text))
    nd = NextDraw(default_logging=False, user_message_fun=emit)
    return nd


def apply_settings(nd, settings):
    for key, value in settings.items():
        if key not in APP_ONLY_SETTINGS:
            setattr(nd.options, key, value)
    # Path joining lives on params, not options: the software joins two path ends that are closer
    # together than this, which is what turns a fill's separate lines into one stroke without a lift
    # between them. Left alone when the setting isn't given, so the software's own default stands.
    if "join_gap" in settings:
        nd.params.min_gap = settings["join_gap"] / 25.4


def dry_run(settings, render, scale=100.0, source=None, mode="plot", layers=None, rotation=0, hatch=None):
    """Simulate the plot without the machine. Returns stats and (optionally) the path preview SVG."""
    log = []
    nd = make_nextdraw(log)
    nd.plot_setup(source if source is not None else prepared_svg(settings, scale, layers, rotation, hatch))
    size_note = None
    if source is None and CURRENT_SVG.exists():
        from lxml import etree
        size_note = normalize_size(etree.parse(str(CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot())
    apply_settings(nd, settings)
    nd.options.mode = mode
    nd.options.preview = True
    nd.options.rendering = render
    output = nd.plot_run(output=render)
    return {
        "estimate_s": nd.time_estimate,
        "pendown_m": nd.distance_pendown,
        "total_m": nd.distance_total,
        "pen_lifts": nd.pen_lifts,
        "doc_in": [nd.svg_width, nd.svg_height],
        "rotated": bool(nd.rotate_page),
        "warnings": ([size_note] if size_note else []) + log,
        "preview_svg": output if render else None,
    }


# A soft tip - a brush - splays when it is pushed instead of pulled, so a tool set up that way travels
# only one way along the width: away from home. Each path is cut where it turns back, and every piece
# is plotted in the safe direction. The drawing comes out the same; it costs pen lifts and travel.
DRAG_FLAT_IN = 0.004    # ~0.1 mm: a step moving less than this across the width picks no direction
DRAG_MIN_RUN_IN = 0.04  # ~1 mm: a shorter run joins the piece before it rather than cost two pen lifts


def drag_runs(points):
    """The path split into runs that each travel one way along the width, as (way, points)."""
    runs, run, way = [], [points[0]], 0
    for a, b in zip(points, points[1:]):
        across = b[0] - a[0]
        step = 0 if abs(across) <= DRAG_FLAT_IN else (1 if across > 0 else -1)
        if step and way and step != way:  # it turns back here, so the path is cut
            runs.append((way, run))
            run, way = [a], step
        else:
            way = way or step  # straight up or down keeps whichever way the run was already going
        run.append(b)
    runs.append((way or 1, run))
    return runs


def drag_pieces(points):
    """The path as pieces that all drag safely: runs too short to matter merged, backwards ones turned."""
    merged = []
    for way, run in drag_runs(points):
        if merged and sum(math.dist(a, b) for a, b in zip(run, run[1:])) < DRAG_MIN_RUN_IN:
            merged[-1][1].extend(run[1:])
        else:
            merged.append([way, list(run)])
    return [list(reversed(run)) if way < 0 else run for way, run in merged]


def limit_drag(svg_text, settings):
    """
    Rewrite the drawing so the tool is always pulled, never pushed. The NextDraw software flattens it
    to polylines for us (its digest), which it can also plot back as it stands, skipping the
    optimizations that would otherwise reorder or reverse what we just decided.
    """
    from lxml import etree
    nd = make_nextdraw([])
    nd.plot_setup(svg_text)
    apply_settings(nd, settings)
    nd.options.digest = 2  # flatten the drawing instead of plotting it
    nd.options.preview = True
    root = etree.fromstring(nd.plot_run(output=True).encode())
    svg = "{http://www.w3.org/2000/svg}"
    for path in list(root.iter(svg + "polyline")):
        points = [tuple(float(n) for n in point.split(",")) for point in (path.get("points") or "").split()]
        if len(points) < 2:
            continue
        parent = path.getparent()
        at = list(parent).index(path)
        for i, piece in enumerate(drag_pieces(points)):
            part = copy.deepcopy(path)  # a copy keeps the plob's own tag and attributes intact
            if path.get("id"):
                part.set("id", f"{path.get('id')}-{i + 1}")
            part.set("points", " ".join(f"{x:.6f},{y:.6f}" for x, y in piece))
            parent.insert(at + i, part)
        parent.remove(path)
    return etree.tostring(root, encoding="unicode")


def prepared_svg(settings, scale, layers=None, rotation=0, hatch=None, raise_mm=0.0):
    """The loaded drawing ready to plot: placed and scaled, and drag-limited for a one-way tool."""
    svg = svg_input(scale, layers, rotation, hatch, raise_mm)
    return limit_drag(svg, settings) if settings.get("drag_only") else svg


def plot_layers(placement):
    """The layers a placement plots. A stopped plot saved before layers could be linked has only `layer`."""
    return placement.get("layers") or ([placement["layer"]] if placement.get("layer") else None)


def carriage_start(placement):
    """Where the carriage starts the plot, in mm from home: the drawing's place plus the tilt offset
    along the width, less the barrel offset down the page (a thin barrel's is negative, so the carriage
    starts lower). The carriage can't start above home, so a drawing placed closer to the top than a
    fat barrel's offset starts at home and its lines move up instead (lines_raised_mm)."""
    return (placement["x"] + placement.get("tip_offset_x", 0.0),
            max(0.0, placement["y"] - placement.get("tip_offset_y", 0.0)))


def lines_raised_mm(placement):
    """How far the drawing's lines are moved up the page because the carriage couldn't start high
    enough to take the whole fat-barrel offset. Only lines within this of the page's top are lost,
    and the tip couldn't reach them anyway."""
    return max(0.0, placement.get("tip_offset_y", 0.0) - placement["y"])


def raise_lines(root, mm):
    """Move every drawing element up the page by `mm`, in the document's own units, the same way
    rotate_document turns them: a transform prepended to each top-level element."""
    if mm <= 0:
        return
    m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$", root.get("height") or "", re.I)
    if not m or m.group(2).lower() not in PX_PER_UNIT:
        raise RuntimeError("This SVG has no size the pen's offset can be measured against.")
    height_mm = float(m.group(1)) * PX_PER_UNIT[m.group(2).lower()] / PX_PER_UNIT["mm"]
    vb = root.get("viewBox")
    units_high = float(re.split(r"[\s,]+", vb.strip())[3]) if vb else float(m.group(1)) * PX_PER_UNIT[m.group(2).lower()]
    shift = f"translate(0 {-mm * units_high / height_mm:g})"
    for child in root:
        if not isinstance(child.tag, str) or child.tag in NON_DRAWING_TAGS:
            continue
        child.set("transform", f"{shift} {child.get('transform')}" if child.get("transform") else shift)


def placement_problem(settings, placement, estimate):
    """
    The NextDraw software limits motion to the plotter's travel measured from the plot's
    start, not from home, so a drawing placed away from home could run past the rails.
    Check the placed drawing against the travel from home. Returns a message, or None.
    """
    model = models.plotters[settings.get("model", 8)]
    width, height = estimate["doc_in"]
    if estimate["rotated"]:
        width, height = height, width
    tol = 0.003
    start_x, start_y = carriage_start(placement)
    if start_x / 25.4 + width > model.travel_x + tol or start_y / 25.4 + height > model.travel_y + tol:
        return ("At this position the drawing would go past the plotter's reach. "
                "Move it closer to home or use a smaller drawing.")
    return None


def set_plot_start(settings, log, placement):
    """
    Make the next plot start at the placement, without moving the carriage, by writing the
    plotter's origin offset (the same offset that walk commands adjust).
    Returns an error code, 0 on success.
    """
    model = settings.get("model", 8)
    problem = []

    def write_offset(nd):
        if not nd.machine.var_read(12):
            if models.plotters[model].auto_home:
                problem.append("not homed")
                return
            nd.homing.find_home()  # Models without homing: treat the current position as home
        start_x, start_y = carriage_start(placement)
        a, b = homing.xy_to_step_pos(nd, start_x / 25.4 * 1000, start_y / 25.4 * 1000)
        serial_utils.write_step_offsets(nd, a, b)
        if serial_utils.read_step_offsets(nd) != [a, b]:
            raise RuntimeError("Couldn't set where the plot starts, so it wasn't plotted.")

    code = run_setup_step(settings, log, "utility", "read_name", after=write_offset)
    if not code and problem:
        # The plot would run homing, which clears the offset. Home first, then set it.
        with job.lock:
            job.message = "Finding home…"
        code = run_setup_step(settings, log, "find_home")
        if not code:
            with job.lock:
                carriage.update(verified=True, motors_on=True)
            problem.clear()
            code = run_setup_step(settings, log, "utility", "read_name", after=write_offset)
    if not code and problem:
        raise RuntimeError("The plotter isn't homed, so the plot start couldn't be set.")
    return code


def go_to_plot_start(nd, placement):
    """
    Make the plot start from its place however it begins. When a plot starts, the NextDraw software
    re-homes the plotter if it doesn't count as homed (it clears that flag whenever it has to turn
    the motors on), and homing resets the plot start to home - so a plot could draw from home. After
    homing, or finding it isn't needed, set the plot start again and move the carriage there with
    the pen up, so the drawing begins where it was placed.
    """
    find_home = nd.homing.find_home

    def find_home_then_start():
        if not find_home():
            return False
        start_x, start_y = carriage_start(placement)
        a, b = homing.xy_to_step_pos(nd, start_x / 25.4 * 1000, start_y / 25.4 * 1000)
        serial_utils.write_step_offsets(nd, a, b)
        if serial_utils.read_step_offsets(nd) != [a, b]:
            raise RuntimeError("Couldn't set where the plot starts, so it wasn't plotted.")
        nd.homing.read_position()  # the carriage's place relative to the plot start
        nd.pen.pen_raise(nd)
        nd.go_to_position(0, 0)
        nd.homing.precision_move_to(0, 0)
        return True

    nd.homing.find_home = find_home_then_start


def load_resume():
    """The stopped plot that can be resumed, or None."""
    try:
        meta = json.loads(RESUME_META.read_text())
    except (OSError, ValueError):
        return None
    if not RESUME_SVG.exists():
        return None
    return meta


def clear_resume():
    for path in (RESUME_SVG, RESUME_META, PLOT_PATHS):
        path.unlink(missing_ok=True)


def save_resume(svg_text, settings, placement, total_mm, speed_pct=100):
    """Keep a stopped plot's progress so it can be resumed. Returns the stopping point in mm."""
    m = re.search(r'pause_dist="(-?\d+)"', svg_text or "")
    pause_mm = int(m.group(1)) / 1000 if m else -1  # stored in µm
    if pause_mm <= 0:
        clear_resume()  # nothing drawn yet: starting over is the same as resuming
        return 0
    RESUME_SVG.write_text(svg_text)
    name_file = JOBS / "current.name"
    RESUME_META.write_text(json.dumps({
        "file": name_file.read_text() if name_file.exists() else None,
        "settings": settings,
        "placement": placement,
        "done_mm": round(pause_mm, 1),
        "total_mm": round(total_mm, 1),
        "speed_pct": speed_pct,
        "saved_at": time.time(),
    }))
    return pause_mm


def resume_source(settings):
    """
    The stopped plot's SVG, set to resume with the current Handling mode. NextDraw resumes with the
    Handling mode saved in the file's plotdata, whatever it's given, but that mode only sets speed
    limits and cornering for paths that are already laid out, so it's safe to change.
    """
    svg_text = RESUME_SVG.read_text()
    handling = settings.get("handling")
    if not handling:
        return svg_text
    return re.sub(r'(<[^>]*plotdata\b[^>]*\bhandling=")\d+(")', rf"\g<1>{handling}\g<2>", svg_text, count=1)


SPEED_PCT_RANGE = (20, 200)
LIVE_SPEED_KEYS = ("speed_pendown", "speed_penup", "accel")


def scaled_speeds(settings, pct):
    """
    The plot's speeds and acceleration at pct percent. Pen lift rates aren't included: they're sent
    to the plotter once when a plot starts, so they can't follow a change made while it runs.
    """
    return {**settings, **{
        key: max(1.0, min(100.0, settings[key] * pct / 100)) for key in LIVE_SPEED_KEYS if key in settings
    }}


def apply_live_speed(nd, settings, pct):
    """
    Change a running plot's speeds. NextDraw plans each path's motion when it gets to it, reading
    the acceleration from its options and the speeds from values enable_motors() works out at the
    start of the plot and of each layer, so set both. The next path drawn uses the new speeds.
    """
    scaled = scaled_speeds(settings, pct)
    for key in LIVE_SPEED_KEYS:
        if key in scaled:
            setattr(nd.options, key, scaled[key])
    params = getattr(nd, "params", None)
    if params is None or not hasattr(params, "speed_limit") or not hasattr(nd, "speed_pendown"):
        return  # not planned yet: enable_motors() will work them out from the options
    pendown = nd.layer_speed_pendown if getattr(nd, "use_layer_speed", False) else nd.options.speed_pendown
    nd.speed_pendown = pendown * params.speed_limit / 100.0
    nd.speed_penup = nd.options.speed_penup * params.speed_up / 100.0


def save_plot_paths(preview_svg, placement):
    """
    Keep the simulated plot's pen-down movement: one path, drawn in plot order, starting a new
    subpath at each pen lowering. The page measures along it to show what's been drawn. The
    artwork and pen-up moves are left out; where the drawing sits is kept on the root.
    """
    from lxml import etree
    root = etree.fromstring(preview_svg.encode("utf8"), etree.XMLParser(huge_tree=True))
    label = f"{INKSCAPE_NS}label"
    for child in list(root):
        if child.get(label) != "% Preview":
            root.remove(child)
            continue
        for group in list(child):
            if group.get(label) != "Pen-down movement":
                child.remove(group)
    root.set("data-x-mm", str(placement["x"]))
    root.set("data-y-mm", str(placement["y"] + lines_raised_mm(placement)))
    PLOT_PATHS.write_bytes(etree.tostring(root))


def run_plot(settings, placement, resume=None):
    """Plot the loaded drawing, or resume a stopped plot (resume = its saved metadata)."""
    log = job.log
    try:
        if resume:
            source, mode = resume_source(settings), "res_plot"
        else:
            clear_resume()  # a new plot replaces any stopped one
            source = prepared_svg(settings, placement["scale"], plot_layers(placement), placement.get("rotation", 0),
                                  placement.get("hatch"), lines_raised_mm(placement))
            mode = "plot"

        # A new plot's simulation also draws its paths; a resumed plot keeps the ones saved when it began.
        estimate = dry_run(scaled_speeds(settings, job.speed_pct), render=not resume, source=source, mode=mode)
        if not resume and estimate["preview_svg"]:
            try:
                save_plot_paths(estimate["preview_svg"], placement)
            except Exception:  # noqa: BLE001 - only the "what's left" view goes without
                PLOT_PATHS.unlink(missing_ok=True)
        problem = placement_problem(settings, placement, estimate)
        if problem:
            with job.lock:
                job.state, job.message = "error", problem
            return
        with job.lock:
            job.total_mm = estimate["pendown_m"] * 1000
            job.estimate_s = estimate["estimate_s"]
            job.done_mm = resume["done_mm"] if resume else 0.0
        # Home before the first plot of a session (find_home_first returns at once once the app has
        # homed): the plot's start is written as an offset from wherever the plotter believes it is,
        # so a drifted step count would place the whole drawing off the paper by that much.
        code = find_home_first(settings, log) or set_plot_start(settings, log, placement)
        if code:
            with job.lock:
                job.state = "error"
                job.message = ERRORS.get(code, f"The plotter reported error code {code}.")
            return
        with job.lock:
            carriage.update(origin_known=True, origin_x=carriage_start(placement)[0], origin_y=carriage_start(placement)[1])
            job.message = ""

        nd = make_nextdraw(log)
        nd.plot_setup(source)
        apply_settings(nd, settings)
        nd.options.mode = mode
        go_to_plot_start(nd, placement)
        with job.lock:
            apply_live_speed(nd, settings, job.speed_pct)
            job.plot_settings = settings
            job.nd = nd
            if job.state == "stopping":  # Stop was pressed while preparing
                job.state, job.message = "stopped", "Stopped before the plot started."
                job.ended = time.time()
                return
            job.state = "plotting"
            job.started = time.time()
        threading.Thread(target=relay_stop, args=(nd,), daemon=True).start()
        output = nd.plot_run(output=True)
        code = abs(nd.errors.code or 0)

        global last_plot_stopped
        last_plot_stopped = code in (102, 103)
        resumable = 0
        if code in (102, 103):
            resumable = save_resume(output, settings, placement, job.total_mm, job.speed_pct)
        elif code == 0:
            clear_resume()

        with job.lock:
            job.nd = None
            carriage["known"] = False
            carriage["pen_up"] = True if code in (0, 102, 103) else None
            job.snapshot()
            job.ended = time.time()
            if code == 0:
                job.done_mm = job.total_mm
                mark_printed(plot_layers(placement))
                job.state = "returning" if placement["return_home"] else "finished"
                job.message = "Plot finished." if not placement["return_home"] else "Returning home…"
            elif code in (102, 103):
                job.state = "stopped"
                job.message = ERRORS[code] + (" You can resume from where it stopped." if resumable else "")
            else:
                job.state = "error"
                job.message = ERRORS.get(code, f"The plot ended with error code {code}.")

        if code == 0:
            if placement["return_home"]:
                # Clear the plot-start offset BEFORE walking home. set_plot_start wrote the drawing's
                # start as the plotter's origin, and "home" means that origin - so returning home with
                # it still in place parks on the last plot's start and calls it home. Every plot after
                # that is placed from there, and nothing on screen says so.
                code = run_setup_step(settings, log, "utility", "read_name",
                                      after=lambda h: serial_utils.write_step_offsets(h, 0, 0))
                with job.lock:
                    carriage.update(origin_x=0.0, origin_y=0.0)
                if not code:
                    code = run_setup_step(settings, log, "utility", "walk_home",
                                          after=lambda h: read_carriage(h, pen_known=False))
                with job.lock:
                    job.state = "finished"
                    job.message = "Plot finished. Carriage is home." if not code else \
                        "Plot finished, but the carriage couldn't return home."
            else:
                # Leave the carriage at the plot start, but don't leave a hidden offset behind.
                run_setup_step(settings, log, "utility", "read_name",
                               after=lambda h: serial_utils.write_step_offsets(h, 0, 0))
                with job.lock:
                    carriage.update(origin_x=0.0, origin_y=0.0)
    except Exception as exc:  # Surface anything unexpected in the GUI
        with job.lock:
            job.state, job.message = "error", f"Something went wrong: {exc}"
            job.ended = time.time()
    finally:
        job.nd = None


def relay_stop(nd):
    """
    Pass a Stop click on to the running plot. plot_run() creates its pause event
    only once it starts, so wait for that event before sending the request.
    """
    while job.nd is nd:
        event = nd.software_initiated_pause_event
        if job.state == "stopping" and event is not None:
            nd.transmit_pause_request()
            return
        time.sleep(0.1)


def mm(inches):
    return round(inches * 25.4, 2)


def read_carriage(nd, pen_known=True):
    """Read position and plot origin (and pen state, if a command set it) while still connected."""
    if nd.machine.port is None:
        return False
    homed = nd.machine.var_read(12)
    steps = nd.machine.query_steps()
    offset = serial_utils.read_step_offsets(nd)
    with job.lock:
        if pen_known:
            carriage["pen_up"] = nd.pen.phys.z_up
        if homed and steps is not None and offset is not None:
            gx, gy = homing.steps_to_xy_pos(nd, steps[0], steps[1])
            ox, oy = homing.steps_to_xy_pos(nd, offset[0] / 1000, offset[1] / 1000)
            carriage.update(known=True, x=mm(gx), y=mm(gy), origin_known=True, origin_x=mm(ox), origin_y=mm(oy))
            return True
        carriage["known"] = False
        return False


def clamp_walks(nd, notes):
    """Keep walk moves inside the plotter's travel, measured from the home corner."""
    original = nd.homing.adjust_origin_offset

    def clamped(delta_x, delta_y):
        steps = nd.machine.query_steps()
        if steps is None:
            raise RuntimeError("Couldn't read the carriage position, so the carriage wasn't moved.")
        x, y = homing.steps_to_xy_pos(nd, steps[0], steps[1])
        max_x, max_y = nd.params.travel_x, nd.params.travel_y
        safe_dx = min(max(x + delta_x, 0.0), max_x) - x
        safe_dy = min(max(y + delta_y, 0.0), max_y) - y
        if abs(safe_dx - delta_x) > 1e-4 or abs(safe_dy - delta_y) > 1e-4:
            notes.append("clamped")
        notes.append("checked")
        original(safe_dx, safe_dy)

    nd.homing.adjust_origin_offset = clamped


def run_setup_step(settings, log, mode, utility_cmd=None, after=None):
    """
    Run one NextDraw command on its own connection. If given, after(nd) runs while still
    connected (utility commands leave the port open). Returns an error code, 0 on success.
    """
    nd = make_nextdraw(log)
    try:
        nd.plot_setup()
        apply_settings(nd, settings)
        nd.options.mode = mode
        if utility_cmd:
            nd.options.utility_cmd = utility_cmd
        nd.plot_run()
        code = abs(nd.errors.code or 0)
        if not code and after is not None:
            if nd.machine.port is None:
                raise RuntimeError("Lost the connection to the plotter.")
            after(nd)
        return code
    finally:
        if nd.machine.port is not None:
            nd.disconnect()


def raise_pen_first(settings, log):
    """
    The NextDraw software moves the carriage with the pen wherever it is, and homing doesn't
    lift it either. Raise it so a lowered pen isn't dragged across the paper.
    """
    if carriage["pen_up"] is True:
        return 0
    with job.lock:
        job.message = "Raising the pen first…"
    code = run_setup_step(settings, log, "utility", "raise_pen")
    if not code:
        with job.lock:
            carriage["pen_up"] = True
    return code


def find_home_first(settings, log, force=False):
    """
    Run the plotter's homing routine, which finds the home corner with its limit switches.
    The plotter otherwise knows its position only by counting motor steps, so if the carriage
    was pushed by hand that count (and our range check) would be wrong.
    Unless forced, this runs only until the app has homed once (or after a release).
    Returns an error code, 0 on success.

    The plotter's own homed flag (var 12) is NOT taken as evidence any more. It says "homing ran at
    some point since the plotter last lost power", which is a different claim from "the step count
    still matches the corner": a carriage nudged by hand, a missed step, or an app restarting while
    the machine stayed powered all leave the flag standing over a step count that has drifted. This
    app trusted it, so it skipped homing and walked by that count - and the carriage sat half an inch
    off the corner while the screen reported home (2026-09-17). Homing once per app start, and again
    after a release, costs one sweep and is the only thing that actually finds the corner.
    """
    model = settings.get("model", 8)
    if not models.plotters[model].auto_home or (carriage["verified"] and not force):
        return 0
    with job.lock:
        job.message = "Finding home…"
    code = run_setup_step(settings, log, "find_home")
    if not code:
        with job.lock:
            carriage.update(verified=True, origin_known=True, origin_x=0.0, origin_y=0.0, motors_on=True)
    return code


def run_manual(command, settings, distance_mm, axis):
    log = job.log
    notes = []
    nd = None
    message = ""
    try:
        if command in ("walk", "home"):
            code = raise_pen_first(settings, log)
            # "Return home" runs the homing routine: its whole job is to put the carriage on the
            # corner, and the step count it would otherwise walk by is exactly what goes wrong - a
            # carriage pushed by hand, a missed step, an app restart that inherited the plotter's
            # homed flag. The exception is straight after a stopped plot: the motors never let go and
            # this app homed before the plot, so the count is good, and a sweep across the whole
            # width is a long, slow way to get back to where a walk would go.
            # A walk still only homes when the position isn't trusted yet.
            straight_back = command == "home" and last_plot_stopped and carriage["verified"]
            if not code:
                code = find_home_first(settings, log, force=(command == "home" and not straight_back))
            if not code and straight_back:
                # The stopped plot left its start written as the plotter's origin, and walking "home"
                # goes to that origin. Clear it first, or the carriage parks on the plot's start.
                code = run_setup_step(settings, log, "utility", "read_name",
                                      after=lambda h: serial_utils.write_step_offsets(h, 0, 0))
            if code:
                with job.lock:
                    job.state = "error"
                    job.message = ERRORS.get(code, f"The plotter reported error code {code}.")
                return
            with job.lock:
                job.message = ""
        nd = make_nextdraw(log)
        nd.plot_setup()
        apply_settings(nd, settings)
        if command == "pen_test":
            nd.options.mode = "cycle"
            message = "Pen lowered and raised. Adjust the heights if needed."
        elif command == "release":
            nd.options.mode = "align"
            message = "Motors off. You can move the carriage by hand; it will find home again before the next move."
        else:
            nd.options.mode = "utility"
            if command == "walk":
                nd.options.utility_cmd = "walk_mmx" if axis == "x" else "walk_mmy"
                nd.options.dist = distance_mm
                clamp_walks(nd, notes)
            elif command == "home":
                nd.options.utility_cmd = "walk_home"
                message = "Carriage is home. The next plot will start there."
            elif command == "pen_setup":
                # Raise the pen to the setup height instead of the lifted height. Plots still lift
                # to "Height when lifted"; the NextDraw software re-applies it when a plot starts.
                nd.options.utility_cmd = "raise_pen"
                nd.options.pen_pos_up = settings.get("pen_setup", 60)
                message = "Pen holder is at the setup height. Mount the pen with your sizing block."
            elif command == "read":
                nd.options.utility_cmd = "read_name"
            else:
                nd.options.utility_cmd = command  # raise_pen / lower_pen

        nd.plot_run()
        code = abs(nd.errors.code or 0)

        if command in ("walk", "home") and not code:
            # Walks shift the plotter's origin offset. Clear it so moving the carriage
            # doesn't change where the next plot starts (placement is a separate setting).
            # Home clears it too: a plot writes the plot's start as the origin and homing is what
            # clears that, so a home that left it behind would park on the last plot's start.
            serial_utils.write_step_offsets(nd, 0, 0)
        if command in ("walk", "home", "read", "raise_pen", "lower_pen", "pen_setup") and not code:
            # A plain read doesn't set the pen, so its pen state isn't meaningful.
            read_carriage(nd, pen_known=command != "read")
        if command == "walk" and not code and "checked" not in notes:
            raise RuntimeError("The range check didn't run, so the move may not have been limited.")

        with job.lock:
            if command in ("walk", "home"):
                carriage["motors_on"] = True
            if command == "release":
                carriage.update(known=False, pen_up=True, motors_on=False, origin_known=False, verified=False)
        if command == "release" and not code:
            # The carriage may now be pushed by hand, so mark the plotter as not homed. The flag
            # lives in the plotter, so it still holds if this app restarts.
            run_setup_step(settings, log, "utility", "read_name", after=lambda h: h.machine.var_write(0, 12))
        with job.lock:
            if command == "pen_test" and not code:
                carriage["pen_up"] = True
            if code:
                job.state = "error"
                job.message = ERRORS.get(code, f"The plotter reported error code {code}.")
            else:
                job.state = "idle"
                if "clamped" in notes:
                    message = "The carriage is at the edge of its range, so it stopped there."
                job.message = message
    except Exception as exc:
        with job.lock:
            job.state, job.message = "error", f"Something went wrong: {exc}"
    finally:
        if nd is not None and nd.machine.port is not None:
            try:
                nd.disconnect()
            except Exception:
                pass


def ensure_presets_file():
    """Make sure the shared presets file is there and downloaded. iCloud can leave only a placeholder
    (".presets.json.icloud") until a file is asked for; brctl asks for it."""
    if PRESETS_FILE == BUNDLED_PRESETS or PRESETS_FILE.exists():
        return
    placeholder = PRESETS_FILE.with_name(f".{PRESETS_FILE.name}.icloud")
    if placeholder.exists():
        subprocess.run(["brctl", "download", str(PRESETS_FILE)], capture_output=True, timeout=10)
        for _ in range(40):  # up to 10 s for the download
            if PRESETS_FILE.exists():
                return
            time.sleep(0.25)
        return
    PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if BUNDLED_PRESETS.exists():
        shutil.copyfile(BUNDLED_PRESETS, PRESETS_FILE)


def load_presets():
    try:
        ensure_presets_file()
        data = json.loads(PRESETS_FILE.read_text())
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def save_presets(presets):
    ensure_presets_file()
    tmp = PRESETS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(presets, indent=2))
    tmp.replace(PRESETS_FILE)


def clean_preset_settings(raw):
    """A preset describes a pen: its heights, lift and drop speeds, and drawing speeds."""
    return {k: v for k, v in clean_settings(raw).items() if k in PRESET_NUMERIC}


# A marker that comes with more than one tip - two ends of the same pen, or the same ink in a second
# barrel - is one preset with variants rather than one preset per tip. What they share is the marker:
# the palette, the barrel it is clipped by, how it is handled. What differs is the tip: how wide it
# draws, how far the pen drops, what it hatches at, whether it is held at a tilt.
# Everything outside this pair of functions sees the flat list it always saw, one entry per tip,
# named as it always was - "Betem Acrylic" and its "Fine" tip resolve to "Betem Acrylic Fine" - so a
# drawing that names a tool, a menu that lists one, and /api/presets/<name> all still find it.
# Inherited per key, not per block: a tip that says nothing about tilt takes the marker's, and one
# that sets it to null has none.
VARIANT_KEYS = ("hatch", "tilt", "drag", "barrel_mm", "palette")


def resolved_name(preset, variant):
    """What a tip is called: the marker's name and the tip's, which is the flat name it always had."""
    return f"{str(preset.get('name') or '').strip()} {str(variant.get('name') or '').strip()}".strip()


def resolve_presets(saved):
    """The presets as every consumer sees them: one entry per tip, the tip's own settings merged over
    the marker's. `family` and `variant` say where each came from, for a menu that groups them."""
    out = []
    for preset in saved:
        variants = preset.get("variants")
        if not isinstance(variants, list) or not variants:
            out.append(preset)
            continue
        for variant in variants:
            if not isinstance(variant, dict):
                continue
            entry = {k: v for k, v in preset.items() if k not in ("variants", "settings")}
            entry["name"] = resolved_name(preset, variant)
            entry["family"] = str(preset.get("name") or "").strip()
            entry["variant"] = str(variant.get("name") or "").strip()
            entry["settings"] = {**(preset.get("settings") or {}), **(variant.get("settings") or {})}
            for key in VARIANT_KEYS:
                if key in variant:
                    if variant[key] is None:
                        entry.pop(key, None)  # the marker has one, this tip hasn't
                    else:
                        entry[key] = variant[key]
            # Some markers come in two weights that don't sell the same colours - the bolder one in a
            # handful, the finer in the whole range. That is one marker and one palette still, so the
            # tip names the colours it comes in and the rest are simply not offered for it. Filtered
            # rather than listed again, so the marker's order is kept and a colour is described once.
            if "colors" in variant:
                allowed = [str(c) for c in (variant["colors"] or [])]
                entry["palette"] = [c for c in (entry.get("palette") or []) if c.get("name") in allowed]
            out.append(entry)
    return out


def find_preset(saved, name):
    """The marker and tip a flat name belongs to, as (preset, variant). The variant is None for a
    marker with no tips of its own, and the pair is (None, None) when nothing answers to the name."""
    name = str(name or "").strip()
    for preset in saved:
        variants = preset.get("variants")
        if isinstance(variants, list) and variants:
            for variant in variants:
                if isinstance(variant, dict) and resolved_name(preset, variant) == name:
                    return preset, variant
        elif str(preset.get("name") or "").strip() == name:
            return preset, None
    return None, None


@app.get("/")
def index():
    return send_from_directory(ROOT / "static", "index.html")


@app.get("/static/<path:name>")
def static_files(name):
    return send_from_directory(ROOT / "static", name)


# Single-stroke fonts, for Studio's text tool: the pen draws each letter as lines rather than
# tracing an outline and filling it. They are SVG fonts (a glyph is a path and an advance), shipped
# with the app - see fonts/OFL.txt and each file's own notice for where they come from.
FONTS = ROOT / "fonts"


@app.get("/api/fonts")
def list_fonts():
    names = sorted(p.stem for p in FONTS.glob("*.svg")) if FONTS.is_dir() else []
    return jsonify(fonts=names)


@app.get("/fonts/<name>.svg")
def font_file(name):
    return send_from_directory(FONTS, f"{Path(name).name}.svg", mimetype="image/svg+xml")


# A small drawing of each tool's tip, named after the tool - "Paper-Mate Flair Bold.svg". They are
# the app's own artwork rather than anything it writes, so they live in the repository beside the
# fonts and travel with the code, not in iCloud Drive with the presets.
TIPS = ROOT / "tips"


@app.get("/tips/<name>.svg")
def tip_file(name):
    """The drawing of a tool's tip. A tip with none of its own falls back to its marker's, so one
    drawing can stand for both ends until each is drawn. Missing is not an error worth shouting
    about - the card simply shows no tip - so this 404s quietly."""
    wanted = Path(str(name)).name
    if (TIPS / f"{wanted}.svg").is_file():
        return send_from_directory(TIPS, f"{wanted}.svg", mimetype="image/svg+xml")
    marker, tip = find_preset(load_presets(), wanted)
    family = str((marker or {}).get("name") or "") if tip is not None else ""
    if family and (TIPS / f"{Path(family).name}.svg").is_file():
        return send_from_directory(TIPS, f"{Path(family).name}.svg", mimetype="image/svg+xml")
    return ("", 404)


@app.get("/studio")
def studio_index():
    """NextDraw Studio: the companion app that makes the drawings this one plots (docs/studio.md).
    Both front ends are built from web/ into static/, and this server serves them both."""
    return send_from_directory(ROOT / "static", "studio.html")


@app.get("/api/info")
def info():
    model_list = [
        {"id": i, "name": models.plotters[i].model_name,
         "travel_in": [models.plotters[i].travel_x, models.plotters[i].travel_y],
         "auto_home": models.plotters[i].auto_home}
        for i in (8, 9, 10, 1, 2, 3, 4, 5, 6, 7)
    ]
    # Each handling mode carries its own speed ceiling and motor resolution, so the same speed
    # setting means a different speed in each one. The page needs both to show a real speed.
    handling = [{"id": i, "name": models.handlers[i].name,
                 "speed_in_s": models.handlers[i].speed,        # pen down, at speed_pendown 100
                 "speed_up_in_s": models.handlers[i].speed_up,  # pen up, at speed_penup 100
                 "steps_per_in": round(nextdraw_conf.native_res_factor * math.sqrt(2)
                                       * (2 if models.handlers[i].resolution == 1 else 1))}
                for i in range(1, 5)]
    return jsonify(models=model_list, handling=handling, walk_supported=WALK_CLAMP_SUPPORTED,
                   presets_file=display_path(PRESETS_FILE))


@app.get("/api/status")
def status():
    with job.lock:
        snap = job.snapshot()
        snap["carriage"] = dict(carriage)
    snap["plotter_found"] = bool(ebb_serial.listEBBports())
    resume = load_resume()
    live = snap["state"] in ("preparing", "plotting", "stopping")
    # Changes when a new plot saves its paths, so the page knows to fetch them again.
    snap["plot_paths"] = PLOT_PATHS.stat().st_mtime_ns if (live or resume) and PLOT_PATHS.exists() else None
    snap["resume"] = {
        "done_mm": resume["done_mm"], "total_mm": resume["total_mm"],
        "speed_pct": resume.get("speed_pct", 100),
        "layer": (resume.get("placement") or {}).get("layer"),  # the layer being plotted, if one
    } if resume else None
    name_file = JOBS / "current.name"
    snap["file"] = name_file.read_text() if CURRENT_SVG.exists() and name_file.exists() else None
    snap["file_opened"] = opened_token() if snap["file"] else None
    with printed_lock:
        snap["printed_layers"] = sorted(printed_layers)
    snap["file_path"] = None
    snap["file_folder"] = None
    snap["sibling_ai"] = None
    if snap["file"] and CURRENT_PATH.exists():
        disk_path = Path(CURRENT_PATH.read_text())
        snap["file_path"] = str(disk_path)
        snap["file_folder"] = display_path(disk_path.parent)
        if disk_path.with_suffix(".ai").exists():
            snap["sibling_ai"] = str(disk_path.with_suffix(".ai"))
        # Changed underneath us - by Studio, or by another Mac's iCloud sync. Never mid-plot: the
        # copy being drawn from mustn't move, and a stopped plot still has to be resumable.
        on_disk = disk_token(disk_path)
        snap["drawing_stale"] = bool(on_disk and loaded_token() and on_disk != loaded_token()) and not (live or resume)
    return jsonify(snap)


# What the drawing on disk looks like now, for telling the page it has been changed underneath it.
# The mtime only gates the work: iCloud can touch it without the contents moving, so what's compared
# is a hash of the bytes, and the hash is only recomputed when the mtime says it might have changed.
_disk_seen = {"key": None, "hash": None}


def disk_token(path):
    try:
        key = (str(path), path.stat().st_mtime_ns)
    except OSError:
        return None
    if _disk_seen["key"] != key:
        try:
            _disk_seen["hash"] = hashlib.sha1(path.read_bytes()).hexdigest()[:16]
        except OSError:
            return None
        _disk_seen["key"] = key
    return _disk_seen["hash"]


def opened_token():
    """Which opening of a drawing the loaded copy is (see load_drawing), or None with nothing loaded."""
    return CURRENT_OPENED.read_text().strip() if CURRENT_OPENED.exists() else None


def loaded_token():
    """The same, for the copy being worked on, written when it's opened or saved."""
    return CURRENT_HASH.read_text().strip() if CURRENT_HASH.exists() else None


def allowed_path(raw):
    """Resolve a path the page sent and make sure it's inside an allowed folder. Returns a Path or None."""
    try:
        path = Path(os.path.expanduser(str(raw))).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    for folder in allowed_folders():
        root = folder.resolve()
        if path == root or root in path.parents:
            return path
    return None


def display_path(path):
    text = str(path)
    icloud = str(ICLOUD_DRIVE)
    if text == icloud or text.startswith(icloud + "/"):
        return "iCloud Drive" + text[len(icloud):]
    home = str(Path.home())
    return "~" + text[len(home):] if text.startswith(home) else text


@app.get("/api/browse")
def browse():
    """List the folders, SVG files and Illustrator files in an allowed folder."""
    folder = allowed_path(request.args.get("path") or allowed_folders()[0])
    if folder is None or not folder.is_dir():
        return jsonify(error="That folder isn't one the app can open drawings from."), 403
    folders, files = [], []
    try:
        entries = sorted(folder.iterdir(), key=lambda p: p.name.lower())
    except OSError as exc:
        return jsonify(error=folder_unreadable(folder)
                       or f"Couldn't read that folder: {exc.strerror or exc}"), 400
    for entry in entries:
        if entry.name.startswith("."):
            continue
        try:
            if entry.is_dir():
                folders.append({"name": entry.name, "path": str(entry)})
            elif entry.suffix.lower() in (".svg", ".ai"):
                info = entry.stat()
                files.append({
                    "name": entry.name,
                    "path": str(entry),
                    "kind": entry.suffix.lower()[1:],
                    "size": info.st_size,
                    "modified": info.st_mtime,
                    "has_svg": entry.suffix.lower() == ".ai" and entry.with_suffix(".svg").exists(),
                })
        except OSError:
            continue
    names = folder_names()
    roots = [folder_root.resolve() for folder_root in names]
    parent = folder.parent if folder not in roots else None
    return jsonify(
        path=str(folder),
        display=display_path(folder),
        parent=str(parent) if parent else None,
        roots=[{"name": name, "path": str(resolved), "added": root not in BUILT_IN_FOLDERS}
               for (root, name), resolved in zip(names.items(), roots)],
        folders=folders,
        files=files,
    )


def folder_unreadable(path):
    """
    Why this folder can't be listed, or None if it can. macOS keeps Documents, Downloads and the like
    behind a privacy prompt that a server started from a script never gets asked, so a folder can
    exist and still be unreadable - better to say so when it's added than to list it and fail later.
    """
    try:
        next(iter(path.iterdir()), None)
    except PermissionError:
        return (f"macOS won't let the app read {display_path(path)}. Give whatever you start the app "
                "from (Terminal, or the app itself) access in System Settings > Privacy & Security > "
                "Files and Folders, or Full Disk Access, then add it again.")
    except OSError as exc:
        return f"Couldn't read {display_path(path)}: {exc.strerror or exc}"
    return None


@app.get("/api/folders")
def list_folders():
    """Every folder drawings may be opened from, and which of them were added by hand."""
    return jsonify(folders=[
        {"name": name, "path": str(path), "display": display_path(path),
         "added": path not in BUILT_IN_FOLDERS}
        for path, name in folder_names().items()
    ], file=display_path(FOLDERS_FILE))


@app.post("/api/folders")
def add_folder():
    """
    Add a folder to the ones drawings may be opened from. The path is typed rather than browsed to,
    because the browser can only show what is already allowed - and because everything listed here is
    readable by anyone on the network while the app is running, so widening it should be deliberate.
    """
    raw = (request.json or {}).get("path", "")
    if not isinstance(raw, str) or not raw.strip():
        return jsonify(error="Give the folder's path."), 400
    try:
        path = Path(os.path.expanduser(raw.strip())).resolve()
    except (OSError, RuntimeError, ValueError):
        return jsonify(error="That isn't a path this Mac can read."), 400
    if not path.is_dir():
        return jsonify(error=f"There's no folder at {display_path(path)}."), 400
    unreadable = folder_unreadable(path)
    if unreadable:
        return jsonify(error=unreadable), 403
    if allowed_path(str(path)) is not None:
        return jsonify(error=f"{display_path(path)} is already somewhere the app can open drawings from."), 409
    write_saved_folders(saved_folders() + [path])
    return list_folders()


@app.delete("/api/folders")
def remove_folder():
    """Drop a folder that was added by hand. The built-in ones stay."""
    raw = (request.json or {}).get("path", "")
    try:
        path = Path(os.path.expanduser(str(raw))).resolve()
    except (OSError, RuntimeError, ValueError):
        return jsonify(error="That isn't a folder the app can forget."), 400
    kept = [folder for folder in saved_folders() if folder != path]
    if len(kept) == len(saved_folders()):
        return jsonify(error="That folder isn't one that was added by hand."), 404
    write_saved_folders(kept)
    return list_folders()


def load_drawing(svg_path):
    """Make an SVG on disk the loaded drawing, remembering where it lives."""
    data = svg_path.read_bytes()
    if b"<svg" not in data:
        raise ValueError("That file doesn't look like an SVG.")
    clear_resume()  # a stopped plot of the previous drawing can't be resumed on this one
    forget_printed()
    CURRENT_SVG.write_bytes(data)
    ensure_layer_ids(CURRENT_SVG)
    (JOBS / "current.name").write_text(svg_path.name)
    CURRENT_PATH.write_text(str(svg_path))
    CURRENT_MTIME.write_text(str(svg_path.stat().st_mtime_ns))
    CURRENT_HASH.write_text(disk_token(svg_path) or "")
    # Every open is new, even of the same file under the same name: Studio's "Open in Plot" saves and
    # reopens the drawing Plot already has, and a Plot page open in another tab has to know to show
    # the new one. The name can't say that, and the file's hash is rewritten by Plot's own saves.
    CURRENT_OPENED.write_text(str(time.time_ns()))
    with job.lock:
        if not job.busy():
            job.reset("idle")
    return read_plot(parse_svg(CURRENT_SVG).getroot())


ILLUSTRATOR_EXPORT_JSX = """
(function () {
    var src = new File(%(src)s);
    var dst = new File(%(dst)s);
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    var doc = null, opened = false;
    for (var i = 0; i < app.documents.length; i++) {
        if (app.documents[i].fullName.fsName == src.fsName) { doc = app.documents[i]; }
    }
    if (!doc) { doc = app.open(src); opened = true; }
    var options = new ExportOptionsSVG();
    options.artBoardClipping = true;              // the page is the artboard, not the artwork's outline
    options.fontType = SVGFontType.OUTLINEFONT;   // text becomes paths the plotter can draw
    options.cssProperties = SVGCSSPropertyLocation.STYLEATTRIBUTES;
    options.embedRasterImages = false;
    options.includeFileInfo = false;
    options.preserveEditability = false;
    options.coordinatePrecision = 3;
    doc.exportFile(dst, ExportType.SVG, options);
    if (opened) { doc.close(SaveOptions.DONOTSAVECHANGES); }
    return "ok";
})();
"""


def import_from_illustrator(ai_path):
    """Have Illustrator export the .ai file's artboard as an SVG next to it. Returns the SVG path."""
    svg_path = ai_path.with_suffix(".svg")
    with tempfile.TemporaryDirectory(dir=JOBS) as tmp:
        tmp_svg = Path(tmp) / "export.svg"
        script = ILLUSTRATOR_EXPORT_JSX % {"src": json.dumps(str(ai_path)), "dst": json.dumps(str(tmp_svg))}
        applescript = f'tell application id "com.adobe.illustrator" to do javascript {json.dumps(script)}'
        try:
            result = subprocess.run(["osascript", "-e", applescript], capture_output=True, text=True, timeout=240)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Illustrator took too long to export the drawing.")
        if result.returncode != 0 or not tmp_svg.exists():
            detail = (result.stderr or result.stdout).strip()
            if "-1743" in detail:
                raise RuntimeError("macOS didn't allow this app to control Illustrator. Allow it in System "
                                   "Settings > Privacy & Security > Automation, then try again.")
            if "-1728" in detail or "Can’t get application" in detail or "Can't get application" in detail:
                raise RuntimeError("Illustrator isn't available on this Mac, so .ai files can't be imported.")
            raise RuntimeError(f"Illustrator couldn't export the drawing. {detail}")
        os.replace(tmp_svg, svg_path)  # swap in the finished file
    return svg_path


# ---------- Combining single-colour files ----------
#
# Artwork often arrives already separated: one file per ink, each a single colour on a single layer,
# all exported from the same artboard. Combining stacks them into one drawing with a layer per file,
# so they can be coloured, ordered and plotted a layer at a time like any other drawing. It happens
# here, once, for both apps: Plot opens what this makes, and Studio edits it.

COMBINED_ATTR = "{%s}combined" % PLOT_NS  # on a drawing this made: adding a file to it rewrites it
SAME_PAGE_IN = 0.5 / 25.4  # pages within half a millimetre of each other are the same page
CARRIED_TAGS = {SVG_NS + t for t in ("defs", "style")}  # anything in the file may refer to these
DROPPED_TAGS = {SVG_NS + t for t in ("metadata", "title", "desc")} | {
    "{http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd}namedview"}
# What a file's own <svg> can set for everything in it, and so what its layer has to carry instead.
INHERITED_ATTRS = ("style", "class", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
                   "stroke-miterlimit", "opacity")
LENGTH = re.compile(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$", re.I)
URL_REF = re.compile(r"url\(\s*['\"]?#([^)'\"\s]+)['\"]?\s*\)")
CLASS_SELECTOR = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"


def page_frame(root):
    """
    Where a document's own units land on its page, in inches - on each axis, inch = s * (unit - min)
    + offset - and the page's size. The page is sized the way the NextDraw software sizes it
    (normalize_size, which this applies), so Illustrator's points stay points. None when nothing in
    the file gives it a size.
    """
    normalize_size(root)

    def inches(value):
        m = LENGTH.match(value or "")
        unit = m.group(2).lower() if m else None
        return float(m.group(1)) * PX_PER_UNIT[unit] / 96.0 if m and unit in PX_PER_UNIT else None

    w, h = inches(root.get("width")), inches(root.get("height"))
    if not w or not h:
        return None
    vb = root.get("viewBox")
    try:
        vb = [float(v) for v in re.split(r"[\s,]+", vb.strip())] if vb else [0.0, 0.0, w * 96, h * 96]
    except ValueError:
        return None
    if len(vb) != 4 or vb[2] <= 0 or vb[3] <= 0:
        return None
    sx, sy = w / vb[2], h / vb[3]
    ox = oy = 0.0
    fit = (root.get("preserveAspectRatio") or "xMidYMid meet").split()
    if fit[0] != "none":
        # A viewBox of another shape than its page is fitted into it, as a browser would.
        s = max(sx, sy) if "slice" in fit else min(sx, sy)
        ax = 0.0 if "xMin" in fit[0] else 1.0 if "xMax" in fit[0] else 0.5
        ay = 0.0 if "YMin" in fit[0] else 1.0 if "YMax" in fit[0] else 0.5
        ox, oy = (w - s * vb[2]) * ax, (h - s * vb[3]) * ay
        sx = sy = s
    return {"w": w, "h": h, "sx": sx, "sy": sy, "ox": ox, "oy": oy, "x": vb[0], "y": vb[1]}


def names_in(root):
    """Every id and class a document uses."""
    used = set()
    for el in root.iter():
        if isinstance(el.tag, str):
            used.update(filter(None, [el.get("id")]))
            used.update((el.get("class") or "").split())
    return used


def keep_apart(root, prefix):
    """
    Put a prefix on every id and class in a file, and on everything that refers to them. Illustrator
    names its classes .st0, .st1 ... in every file it exports, so two files stacked as they are would
    share a class - and whichever file's style came last would colour both.
    """
    ids = {el.get("id") for el in root.iter() if isinstance(el.tag, str) and el.get("id")}

    def ref(m):
        return f"url(#{prefix}{m.group(1)})" if m.group(1) in ids else m.group(0)

    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        if el.get("id"):
            el.set("id", prefix + el.get("id"))
        if el.get("class"):
            el.set("class", " ".join(prefix + c for c in el.get("class").split()))
        for attr, value in list(el.attrib.items()):
            if attr in ("href", XLINK_HREF) and value.startswith("#") and value[1:] in ids:
                el.set(attr, "#" + prefix + value[1:])
            elif "url(" in value:
                el.set(attr, URL_REF.sub(ref, value))
    for style in root.iter(SVG_NS + "style"):
        # Selectors sit outside the braces and declarations inside them. Every class selector is
        # prefixed, used or not: an unused .st1 left as it is would reach the other files' .st1.
        parts = re.split(r"(\{[^}]*\})", style.text or "")
        style.text = "".join(
            URL_REF.sub(ref, p) if p.startswith("{") else CLASS_SELECTOR.sub(lambda m: f".{prefix}{m.group(1)}", p)
            for p in parts
        )


def unused_prefix(used):
    n = 1
    while any(name.startswith(f"c{n}-") for name in used):
        n += 1
    return f"c{n}-"


def as_layer(root, name, transform):
    """
    A file's drawing as one layer, and what it keeps at the top of its document (its defs and style),
    which have to move to the top of the combined one. What the file's own <svg> set for everything in
    it moves onto the layer, and layers the file had inside it become plain groups: it is one layer now.
    """
    from lxml import etree
    layer = etree.Element(SVG_NS + "g")
    layer.set(INKSCAPE_NS + "groupmode", "layer")
    layer.set(INKSCAPE_NS + "label", name)
    for attr in INHERITED_ATTRS:
        if root.get(attr):
            layer.set(attr, root.get(attr))
    if transform:
        layer.set("transform", transform)
    carried = []
    for child in list(root):
        if not isinstance(child.tag, str) or child.tag in DROPPED_TAGS or child.tag in (PLOT_TAG, LEGACY_PLOT_TAG):
            continue
        (carried if child.tag in CARRIED_TAGS else layer).append(child)
    for group in layer.iter(SVG_NS + "g"):
        if group is not layer:
            group.attrib.pop(INKSCAPE_NS + "groupmode", None)
    return layer, carried


def make_layers_explicit(root):
    """
    Mark a drawing's layers as layers. A file with no Inkscape layers has its top-level groups read as
    its layers (Illustrator's way), and one Inkscape layer added beside them would hide every one.
    """
    if any(g.get(INKSCAPE_NS + "groupmode") == "layer" for g in root if g.tag == SVG_NS + "g"):
        return
    illustrator = is_illustrator_svg(root)
    for group in layer_groups(root):
        group.set(INKSCAPE_NS + "groupmode", "layer")
        name = layer_name(group, illustrator)
        if name and not group.get(INKSCAPE_NS + "label"):
            group.set(INKSCAPE_NS + "label", name)


def combine_drawings(parts, base=None):
    """
    Stack files into one drawing, a layer each. `parts` is (name, root) for each file, bottom first:
    the first is layer 1 and plots first. With a `base` - a drawing already open - they are added on
    top of it and it keeps its page and its layers as they were; without one, the first file's page is
    the page. Each file keeps its place on its own page, so files exported from one artboard register
    exactly. Returns the combined root, and the names of any files whose page isn't the same size,
    which will need lining up by hand.
    """
    from lxml import etree
    if base is None:
        first_name, first = parts[0]
        frame = page_frame(first)
        if frame is None:
            raise ValueError(f"{first_name} has no page size, so there's nothing to line the others up to.")
        out = etree.Element(SVG_NS + "svg", nsmap={None: SVG_NS[1:-1], "inkscape": INKSCAPE_NS[1:-1], "nds": PLOT_NS})
        for attr in ("width", "height", "viewBox", "preserveAspectRatio"):
            if first.get(attr):
                out.set(attr, first.get(attr))
    else:
        out = base
        frame = page_frame(out)
        if frame is None:
            raise ValueError("The open drawing has no page size, so there's nothing to line the files up to.")
        make_layers_explicit(out)
    out.set(COMBINED_ATTR, "true")

    used = names_in(out)
    mismatched = []
    for name, root in parts:
        f = page_frame(root)
        if f is None:
            raise ValueError(f"{name} has no page size, so there's nothing to line it up by.")
        if abs(f["w"] - frame["w"]) > SAME_PAGE_IN or abs(f["h"] - frame["h"]) > SAME_PAGE_IN:
            mismatched.append(name)
        prefix = unused_prefix(used)
        keep_apart(root, prefix)
        used |= names_in(root)
        # This file's units into the page's: each is a scale and a shift, so the two together are too.
        kx, ky = f["sx"] / frame["sx"], f["sy"] / frame["sy"]
        tx = (f["ox"] - frame["ox"] - f["sx"] * f["x"]) / frame["sx"] + frame["x"]
        ty = (f["oy"] - frame["oy"] - f["sy"] * f["y"]) / frame["sy"] + frame["y"]
        same = abs(kx - 1) < 1e-9 and abs(ky - 1) < 1e-9 and abs(tx) < 1e-9 and abs(ty) < 1e-9
        layer, carried = as_layer(root, name, None if same else f"matrix({kx:.10g} 0 0 {ky:.10g} {tx:.10g} {ty:.10g})")
        layer_id = f"{AUTO_LAYER_ID}{len(layer_groups(out)) + 1}"
        while layer_id in used:
            layer_id += "_"
        layer.set("id", layer_id)
        used.add(layer_id)
        out.extend(carried)
        out.append(layer)
    return out, mismatched


def combine_sources(raw_paths, mode):
    """
    The files the page chose to combine, read: (name, root) each, named after the file. An .ai file is
    imported the way /api/open imports one, and asks the same question when its SVG is already there -
    once for all of them. Returns (parts, first path), or (None, response) with what to send back instead.
    """
    if not isinstance(raw_paths, list) or not raw_paths:
        return None, (jsonify(error="Choose the files to combine."), 400)
    paths = []
    for raw in raw_paths:
        path = allowed_path(raw)
        if path is None or not path.is_file():
            return None, (jsonify(error="One of those files isn't in a folder the app can open drawings from."), 403)
        if path.suffix.lower() not in (".svg", ".ai"):
            return None, (jsonify(error=f"{path.name} isn't an SVG or Illustrator (.ai) file."), 400)
        paths.append(path)
    waiting = [p.with_suffix(".svg").name for p in paths if p.suffix.lower() == ".ai" and p.with_suffix(".svg").exists()]
    if waiting and mode not in ("existing", "import"):
        return None, (jsonify(choice=True, svg_names=waiting))
    parts = []
    try:
        for path in paths:
            if path.suffix.lower() == ".ai":
                existing = path.with_suffix(".svg")
                path = existing if existing.exists() and mode == "existing" else import_from_illustrator(path)
            if path.stat().st_size > MAX_STUDIO_SVG:
                return None, (jsonify(error=f"{path.name} is too big to combine."), 413)
            parts.append((path.stem, parse_svg(path).getroot()))
    except (OSError, ValueError, RuntimeError) as exc:
        return None, (jsonify(error=str(exc)), 400)
    except Exception as exc:  # noqa: BLE001 - lxml's own errors, from a file that isn't well-formed SVG
        return None, (jsonify(error=f"Couldn't read {path.name}: {exc}"), 400)
    return parts, paths[0]


def combined_path(folder, stem):
    """A new file next to the originals, never one of them: "<stem> combined.svg", numbered if taken."""
    path = folder / f"{stem} combined.svg"
    n = 2
    while path.exists():
        path = folder / f"{stem} combined {n}.svg"
        n += 1
    return path


@app.post("/api/combine")
def combine():
    """
    Plot: open several single-colour files as one drawing, a layer each - or, with add, put them on
    top of the drawing that's open. The result is saved as a new SVG next to the first file and opened.
    A drawing this made is rewritten when more is added to it; anything else is left as it is and a
    new file is made. Files whose page isn't the same size come back as mismatched: Studio lines
    them up.
    """
    if job.busy():
        return jsonify(error="Wait for the plotter to finish before opening a drawing."), 409
    body = request.json or {}
    add = bool(body.get("add"))
    if add and not CURRENT_SVG.exists():
        return jsonify(error="Open a drawing to add to first."), 400
    parts, first_path = combine_sources(body.get("paths"), body.get("mode"))
    if parts is None:
        return first_path  # what to answer instead
    try:
        if add:
            tree = parse_svg(CURRENT_SVG)
            disk = Path(CURRENT_PATH.read_text()) if CURRENT_PATH.exists() else None
            ours = disk is not None and disk.exists() and tree.getroot().get(COMBINED_ATTR) == "true"
            name = (JOBS / "current.name").read_text() if (JOBS / "current.name").exists() else first_path.name
            root, mismatched = combine_drawings(parts, base=tree.getroot())
            out = disk if ours else combined_path((disk or first_path).parent, Path(name).stem)
        else:
            root, mismatched = combine_drawings(parts)
            out = combined_path(first_path.parent, first_path.stem)
        if allowed_path(out) is None:
            return jsonify(error="That folder isn't one the app can save drawings in."), 403
        from lxml import etree
        etree.cleanup_namespaces(root, top_nsmap={"inkscape": INKSCAPE_NS[1:-1], "nds": PLOT_NS})
        tmp = out.with_name(f".{out.name}.combining")
        tmp.write_bytes(etree.tostring(root, xml_declaration=True, encoding="utf-8"))
        os.replace(tmp, out)
        plot = load_drawing(out)
    except (OSError, ValueError) as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(name=out.name, path=str(out), folder=display_path(out.parent), plot=plot,
                   opened=opened_token(), mismatched=mismatched)


@app.post("/api/studio/combine")
def studio_combine():
    """
    Studio: the same combining, handed back rather than saved - Studio saves when it is asked to, like
    any drawing it makes. With base, the files go on top of the drawing Studio has open (its SVG, as
    Studio would save it). The name and folder are where the drawing would be saved: next to the first
    file, never over it.
    """
    body = request.json or {}
    base = body.get("base")
    if base is not None and (not isinstance(base, str) or "<svg" not in base):
        return jsonify(error="That doesn't look like an SVG."), 400
    parts, first_path = combine_sources(body.get("paths"), body.get("mode"))
    if parts is None:
        return first_path  # what to answer instead
    from lxml import etree
    try:
        base_root = etree.fromstring(base.encode("utf-8"), etree.XMLParser(huge_tree=True)) if base else None
        root, mismatched = combine_drawings(parts, base=base_root)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except etree.XMLSyntaxError as exc:
        return jsonify(error=f"Couldn't read the open drawing: {exc}"), 400
    etree.cleanup_namespaces(root, top_nsmap={"inkscape": INKSCAPE_NS[1:-1], "nds": PLOT_NS})
    svg = etree.tostring(root, encoding="unicode")
    if len(svg.encode("utf-8")) > MAX_STUDIO_SVG:
        return jsonify(error="Together those files are too big to edit here."), 413
    out = combined_path(first_path.parent, first_path.stem)
    return jsonify(name=out.name, folder=display_path(out.parent), folder_path=str(out.parent), svg=svg,
                   mismatched=mismatched)


@app.post("/api/open")
def open_file():
    """
    Open a drawing by its location. SVGs open directly. An .ai file is imported: Illustrator exports
    an SVG next to it, which becomes the working file. If that SVG already exists, the page is asked
    whether to open it or import again (mode: "existing" or "import").
    """
    if job.busy():
        return jsonify(error="Wait for the plotter to finish before opening a drawing."), 409
    body = request.json or {}
    path = allowed_path(body.get("path", ""))
    if path is None or not path.is_file():
        return jsonify(error="That file isn't in a folder the app can open drawings from."), 403
    suffix = path.suffix.lower()
    try:
        if suffix == ".svg":
            svg_path = path
        elif suffix == ".ai":
            existing = path.with_suffix(".svg")
            mode = body.get("mode")
            if existing.exists() and mode not in ("existing", "import"):
                return jsonify(choice=True, svg_name=existing.name)
            svg_path = existing if (existing.exists() and mode == "existing") else import_from_illustrator(path)
        else:
            return jsonify(error="Choose an SVG or Illustrator (.ai) file."), 400
        plot = load_drawing(svg_path)
    except (OSError, ValueError, RuntimeError) as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(name=svg_path.name, path=str(svg_path), folder=display_path(svg_path.parent), plot=plot,
                   opened=opened_token())


@app.get("/api/drawing")
def get_drawing():
    if not CURRENT_SVG.exists():
        return jsonify(error="Load an SVG first."), 400
    try:
        return jsonify(plot=read_plot(parse_svg(CURRENT_SVG).getroot()))
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=f"Couldn't read that SVG: {exc}"), 400


def clean_plot(raw):
    """Only the choices the page saves into a drawing, with sane values."""
    out = {}
    placement = raw.get("placement")
    if isinstance(placement, dict):
        try:
            out["placement"] = {k: round(max(0.0, min(2000.0, float(placement[k]))), 3) for k in ("x", "y")}
        except (KeyError, TypeError, ValueError):
            pass
    if "scale" in raw:
        out["scale"] = clean_scale(raw)
    if "rotation" in raw:
        out["rotation"] = clean_rotation(raw)
    if isinstance(raw.get("tool"), str):
        out["tool"] = raw["tool"][:40]
    # Small paths: how much to slow the plotter for drawings full of tiny marks (percent), or absent.
    try:
        if raw.get("small_paths") is not None:
            out["small_paths"] = int(max(10, min(90, float(raw["small_paths"]))))
    except (TypeError, ValueError):
        pass
    # The order to plot the layers in, bottom first, by layer id. Which ink goes down before which is
    # a decision about the plot - lighter first, so the darks overprint them - not a change to the
    # drawing, so the file's own layer order is left alone and this says what to do with it instead.
    order = raw.get("layer_order")
    if isinstance(order, list):
        ids = [str(x)[:200] for x in order if isinstance(x, str)][:500]
        if ids:
            out["layer_order"] = ids
    # The ink each layer is being plotted in today, by layer id, when it isn't the color the drawing
    # was made with. The operator swaps a pen to see how the drawing looks in it; that's a choice about
    # this plot, not about the artwork, so it lives here and the drawing's own colors stay untouched -
    # which is also what lets it be put back.
    #
    # A pen is recorded as the pen it is - {"tool", "pen"} and the colour it had as a fallback - so
    # that editing the palette moves every layer using it. A bare hex is a colour picked with the
    # system colour picker, and is also what every file written before pens were recorded holds; both
    # are read, so those files keep working.
    inks = raw.get("layer_colors")
    if isinstance(inks, dict):
        picked = {}
        for k, v in inks.items():
            if isinstance(v, str) and HEX_COLOR.match(v):
                picked[str(k)[:200]] = v.lower()
            elif isinstance(v, dict) and isinstance(v.get("tool"), str) and isinstance(v.get("pen"), str):
                pen = {"tool": v["tool"][:40], "pen": v["pen"][:60]}
                if isinstance(v.get("hex"), str) and HEX_COLOR.match(v["hex"]):
                    pen["hex"] = v["hex"].lower()
                picked[str(k)[:200]] = pen
        if picked:
            out["layer_colors"] = dict(list(picked.items())[:500])
    # What Plot calls each layer (by layer id), when that isn't what the drawing calls it: choosing an
    # ink renames the layer to that ink, so the Layers card reads as the list of pens to load. It is
    # kept here, not written onto the layer, because <nds:design> maps Studio's shapes to their layer
    # BY NAME - renaming the layer in the file would leave Studio unable to find what's on it.
    names = raw.get("layer_names")
    if isinstance(names, dict):
        called = {
            str(k)[:200]: v.strip()[:60]
            for k, v in names.items()
            if isinstance(v, str) and v.strip()
        }
        if called:
            out["layer_names"] = dict(list(called.items())[:500])
    # Hatch spacings chosen while plotting, by layer id, in mm: the ink turned out to want its Studio
    # fills closer or further apart. Plot regenerates the fills at this spacing when it plots; the
    # drawing's own fills, and the spacing Studio gave them, are left as they are.
    hatch = clean_hatch(raw)
    if hatch:
        out["hatch_spacing"] = hatch
    # Layers linked to print together (groups of layer ids): layers going down in the same pen, plotted
    # in one pass instead of one after another with the same pen reloaded. A decision about the plot,
    # like the inks above, so it lives here.
    links = raw.get("layer_links")
    if isinstance(links, list):
        groups = []
        for group in links[:250]:
            if isinstance(group, list):
                ids = list(dict.fromkeys(str(x)[:200] for x in group if isinstance(x, str)))[:500]
                if len(ids) > 1:
                    groups.append(ids)
        if groups:
            out["layer_links"] = groups
    # Which layers Plot is holding back (by layer id). Kept here rather than as a hidden attribute on
    # the layer itself: hiding a layer is Plot deciding what to draw today, not a change to the
    # drawing, so it goes in Plot's own block where Studio will never see it.
    hidden = raw.get("hidden_layers")
    if isinstance(hidden, list):
        out["hidden_layers"] = [str(x)[:200] for x in hidden if isinstance(x, str)][:500]
    # A second drawing tool for mixed-media drawings, and which layers use it (by layer id).
    if isinstance(raw.get("second_tool"), str) and raw["second_tool"]:
        out["second_tool"] = raw["second_tool"][:40]
        layers = raw.get("second_tool_layers")
        if isinstance(layers, list):
            out["second_tool_layers"] = [str(x)[:200] for x in layers if isinstance(x, str)][:500]
    paper = raw.get("paper")
    if isinstance(paper, dict):
        cleaned = {}
        for key in ("paper_w", "paper_h", "paper_x", "paper_y"):
            try:
                cleaned[key] = max(0.0, min(2000.0, float(paper[key])))
            except (KeyError, TypeError, ValueError):
                pass
        if isinstance(paper.get("paper_size"), str):
            cleaned["paper_size"] = paper["paper_size"][:40]
        if isinstance(paper.get("paper_color"), str) and HEX_COLOR.match(paper["paper_color"]):
            cleaned["paper_color"] = paper["paper_color"].lower()
        out["paper"] = cleaned
    return out


@app.post("/api/drawing")
def save_drawing():
    """
    Save how the drawing is to be plotted - placement, scale, rotation, tool, paper, which layers
    are hidden - into Plot's own metadata block. Nothing else in the drawing is touched: the geometry
    and the layers are Studio's, and Plot only ever swaps this one block. The loaded copy is always
    updated; a drawing opened from a folder is also written back to its file.
    """
    body = request.json or {}
    problem, disk_path = saving_problem(body)
    if problem:
        return problem
    try:
        tree = parse_svg(CURRENT_SVG)
        root = tree.getroot()
        if isinstance(body.get("plot"), dict):
            plot = clean_plot(body["plot"])
            kept = (read_plot(root) or {}).get("original_page")
            if kept:
                plot["original_page"] = kept  # set by Trim to drawing, not by the page's choices
            write_plot(root, plot)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=f"Couldn't save the drawing: {exc}"), 400
    problem = commit_drawing(tree, disk_path)
    if problem:
        return problem
    return jsonify(saved_to=display_path(disk_path.parent) if disk_path else None)


def saving_problem(body):
    """Checks before changing the loaded drawing. Returns (error response or None, file on disk or None)."""
    if job.busy():
        return (jsonify(error="Changes are saved once the plotter is done."), 409), None
    if not CURRENT_SVG.exists():
        return (jsonify(error="Load an SVG first."), 400), None
    name_file = JOBS / "current.name"
    if body.get("file") != (name_file.read_text() if name_file.exists() else None):
        # Another window (or this one, before it caught up) loaded a different drawing since.
        return (jsonify(error="A different drawing was opened in another window. Reload this page."), 409), None
    disk_path = Path(CURRENT_PATH.read_text()) if CURRENT_PATH.exists() else None
    if disk_path is not None:
        if allowed_path(str(disk_path)) is None or not disk_path.exists():
            return (jsonify(error=f"{disk_path.name} is no longer in {display_path(disk_path.parent)}. Open it again to keep saving."), 409), None
        opened = CURRENT_MTIME.read_text().strip() if CURRENT_MTIME.exists() else ""
        if opened and str(disk_path.stat().st_mtime_ns) != opened:
            return (jsonify(error=f"{disk_path.name} was changed by another app. Open it again to keep saving."), 409), None
    return None, disk_path


def commit_drawing(tree, disk_path):
    """Write the changed drawing to the loaded copy and, if it came from a folder, to its file."""
    from lxml import etree
    etree.cleanup_namespaces(tree, top_nsmap={"inkscape": INKSCAPE_NS[1:-1]})
    data = svg_bytes(tree)
    tmp = CURRENT_SVG.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, CURRENT_SVG)
    if disk_path is not None:
        try:
            tmp = disk_path.with_name(f".{disk_path.name}.nextdraw-saving")
            tmp.write_bytes(data)
            shutil.copymode(disk_path, tmp)
            os.replace(tmp, disk_path)
            CURRENT_MTIME.write_text(str(disk_path.stat().st_mtime_ns))
            CURRENT_HASH.write_text(disk_token(disk_path) or "")
        except OSError as exc:
            return jsonify(error=f"Couldn't save {disk_path.name}: {exc.strerror or exc}"), 500
    return None


def drawing_bounds(settings):
    """
    The box around every line in the drawing, in inches from the page's top-left, as the NextDraw
    software flattens it: all layers, hidden ones included, so every color is trimmed alike. Clipping
    masks aren't taken into account, so clipped artwork can make the box a little looser than what
    shows. Returns (x0, y0, x1, y1, page_w, page_h) or None when there are no lines.
    """
    from lxml import etree
    root = parse_svg(CURRENT_SVG).getroot()
    normalize_size(root)
    for group in layer_groups(root):
        set_layer_hidden(group, False)
    nd = make_nextdraw([])
    nd.plot_setup(etree.tostring(root, encoding="unicode"))
    apply_settings(nd, settings)  # the plotter model sets the travel the lines are kept within; never auto-turned
    nd.options.mode = "plot"
    nd.options.preview = True
    nd.options.digest = 2  # flatten to polylines only; no plot or simulation
    plob = nd.plot_run(output=True)
    doc = etree.fromstring(plob.encode("utf-8"), etree.XMLParser(huge_tree=True))
    xs, ys = [], []
    for node in doc.iter("{http://www.w3.org/2000/svg}polyline"):
        numbers = re.findall(r"-?\d*\.?\d+(?:e[-+]?\d+)?", node.get("points") or "")
        xs.extend(float(v) for v in numbers[0::2])
        ys.extend(float(v) for v in numbers[1::2])
    if not xs:
        return None
    vb = [float(v) for v in re.split(r"[\s,]+", doc.get("viewBox").strip())]
    return min(xs), min(ys), max(xs), max(ys), vb[2], vb[3]


def turned_offset(box, page_w, page_h, rotation):
    """Where a box inside the page ends up from the turned page's top-left, in inches."""
    x0, y0, x1, y1 = box
    return {
        0: (x0, y0),
        90: (page_h - y1, x0),
        180: (page_w - x1, page_h - y1),
        270: (y0, page_w - x1),
    }[rotation]


@app.post("/api/trim")
def trim_to_drawing():
    """
    Shrink the page to the lines in the drawing. The original page is kept in the metadata so Restore
    page can put it back. Returns how far the lines sit from the old page's corner (mm, as placed:
    turned and scaled), so the page can move the drawing by that much and the lines stay put.
    """
    body = request.json or {}
    problem, disk_path = saving_problem(body)
    if problem:
        return problem
    try:
        tree = parse_svg(CURRENT_SVG)
        root = tree.getroot()
        plot = read_plot(root) or {}
        if plot.get("original_page"):
            return jsonify(error="The page is already trimmed to the drawing."), 409
        bounds = drawing_bounds(clean_settings(body))
        if not bounds:
            return jsonify(error="There are no lines in this drawing to trim to."), 400
        x0, y0, x1, y1, page_w, page_h = bounds
        # A hair of page around the drawing, never a page that hugs it exactly. The NextDraw software
        # clips at the page edge, and a line lying ON that edge is the one thing a trim to the bounds
        # guarantees: a hatch fill drawn as one path runs its connectors along the shape's outline, so
        # trimming used to cut every connector and hand back the separate lines the fill was joined to
        # avoid - 33 pen lifts where there should have been 3. Kept inside the old page, so the drawing
        # never has to move to a negative position to stay where it is.
        x0, y0 = max(0.0, x0 - TRIM_MARGIN_IN), max(0.0, y0 - TRIM_MARGIN_IN)
        x1, y1 = min(page_w, x1 + TRIM_MARGIN_IN), min(page_h, y1 + TRIM_MARGIN_IN)
        sized = parse_svg(CURRENT_SVG).getroot()
        normalize_size(sized)
        vb = sized.get("viewBox")
        vx, vy, vw, vh = [float(v) for v in re.split(r"[\s,]+", vb.strip())] if vb else (0, 0, page_w * 96, page_h * 96)
        ux, uy = vw / page_w, vh / page_h  # user units per inch
        plot["original_page"] = {k: root.get(k) for k in ("width", "height", "viewBox")}
        root.set("viewBox", f"{vx + x0 * ux:g} {vy + y0 * uy:g} {(x1 - x0) * ux:g} {(y1 - y0) * uy:g}")
        root.set("width", f"{x1 - x0:g}in")
        root.set("height", f"{y1 - y0:g}in")
        write_plot(root, plot)
        dx, dy = turned_offset((x0, y0, x1, y1), page_w, page_h, clean_rotation(body))
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=f"Couldn't trim the drawing: {exc}"), 400
    problem = commit_drawing(tree, disk_path)
    if problem:
        return problem
    factor = clean_scale(body) / 100 * 25.4
    return jsonify(offset_mm=[dx * factor, dy * factor])


@app.post("/api/untrim")
def restore_page():
    """Put back the page Trim to drawing removed. Returns the offset to move the drawing back by (mm)."""
    body = request.json or {}
    problem, disk_path = saving_problem(body)
    if problem:
        return problem
    try:
        tree = parse_svg(CURRENT_SVG)
        root = tree.getroot()
        plot = read_plot(root) or {}
        original = plot.pop("original_page", None)
        if not original:
            return jsonify(error="This drawing's page hasn't been trimmed."), 409
        trimmed = parse_svg(CURRENT_SVG).getroot()
        normalize_size(trimmed)
        for key in ("width", "height", "viewBox"):
            if original.get(key) is None:
                root.attrib.pop(key, None)
            else:
                root.set(key, original[key])
        write_plot(root, plot)
        # Work out where the trimmed page sat on the restored one. A copy of the whole document, so
        # the Illustrator comment before <svg> still tells normalize_size the units are points.
        import copy
        restored = copy.deepcopy(tree).getroot()
        normalize_size(restored)
        def box(el):
            def inches(value):
                m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$", value or "", re.I)
                return float(m.group(1)) * PX_PER_UNIT[m.group(2).lower()] / 96
            w, h = inches(el.get("width")), inches(el.get("height"))
            vb = el.get("viewBox")
            vb = [float(v) for v in re.split(r"[\s,]+", vb.strip())] if vb else [0, 0, w * 96, h * 96]
            return vb, w, h
        (tvb, tw, th), (ovb, ow, oh) = box(trimmed), box(restored)
        ux, uy = ovb[2] / ow, ovb[3] / oh
        x0, y0 = (tvb[0] - ovb[0]) / ux, (tvb[1] - ovb[1]) / uy
        dx, dy = turned_offset((x0, y0, x0 + tw, y0 + th), ow, oh, clean_rotation(body))
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=f"Couldn't restore the page: {exc}"), 400
    problem = commit_drawing(tree, disk_path)
    if problem:
        return problem
    factor = clean_scale(body) / 100 * 25.4
    return jsonify(offset_mm=[-dx * factor, -dy * factor])



@app.post("/api/upload")
def upload():
    if job.busy():
        return jsonify(error="Wait for the current plot to finish before loading a new file."), 409
    file = request.files.get("file")
    if not file or not file.filename.lower().endswith(".svg"):
        return jsonify(error="Choose an SVG file."), 400
    data = file.read()
    if b"<svg" not in data[:4096] and b"<svg" not in data:
        return jsonify(error="That file doesn't look like an SVG."), 400
    clear_resume()  # a stopped plot of the previous drawing can't be resumed on this one
    forget_printed()
    CURRENT_SVG.write_bytes(data)
    try:
        ensure_layer_ids(CURRENT_SVG)
        plot = read_plot(parse_svg(CURRENT_SVG).getroot())
    except Exception:  # noqa: BLE001 - an unreadable SVG is reported by the estimate
        plot = None
    (JOBS / "current.name").write_text(file.filename)
    CURRENT_PATH.unlink(missing_ok=True)  # an uploaded copy isn't linked to a file on disk
    CURRENT_MTIME.unlink(missing_ok=True)
    with job.lock:
        if not job.busy():
            job.reset("idle")
    return jsonify(name=file.filename, plot=plot)


# Anything that isn't a plain name is replaced rather than rejected, so a drawing called "1/2 done"
# still saves. The basename comes first, so no name can climb out of the folder it's saved in.
STUDIO_NAME_STRIP = re.compile(r"[^\w \-.()\[\]]+")


def studio_file_name(raw):
    """A file name from Studio, reduced to one that's safe to write. None when nothing is left."""
    base = os.path.basename(str(raw or "")).strip()
    if base.lower().endswith(".svg"):
        base = base[:-4]
    base = STUDIO_NAME_STRIP.sub("-", base).strip(" .-")[:60].strip()
    return f"{base}.svg" if base else None


@app.get("/api/studio/read")
def studio_read():
    """
    Hand a drawing's SVG to Studio so it can be edited again. Read-only on purpose: unlike /api/open
    this doesn't make the file the loaded drawing, so picking something to edit in Studio can't change
    what Plot is about to print. An .ai file is imported the way Plot imports one - Illustrator exports
    an SVG next to it - because getting a drawing that isn't plot-ready into Plot is Studio's job. The
    file browser lists .ai files in both apps, so refusing them here only looked like a broken picker.
    """
    path = allowed_path(request.args.get("path", ""))
    if path is None or not path.is_file() or path.suffix.lower() not in (".svg", ".ai"):
        return jsonify(error="That isn't a drawing the app can open."), 403
    if path.suffix.lower() == ".ai":
        existing = path.with_suffix(".svg")
        mode = request.args.get("mode")
        if existing.exists() and mode not in ("existing", "import"):
            return jsonify(choice=True, svg_name=existing.name)
        try:
            path = existing if (existing.exists() and mode == "existing") else import_from_illustrator(path)
        except (OSError, ValueError, RuntimeError) as exc:
            return jsonify(error=str(exc)), 400
    if path.stat().st_size > MAX_STUDIO_SVG:
        return jsonify(error=f"{path.name} is too big to edit here."), 413
    try:
        svg = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return jsonify(error=f"Couldn't read {path.name}: {exc.strerror or exc}"), 500
    return jsonify(name=path.name, path=str(path), folder=display_path(path.parent), svg=svg)


@app.post("/api/studio/save")
def studio_save():
    """
    Write a drawing Studio made into a folder this app can open from, so it can then be opened for
    plotting like any other file. Saving doesn't load it - Studio calls /api/open for that.
    """
    body = request.json or {}
    svg = body.get("svg")
    if not isinstance(svg, str) or "<svg" not in svg:
        return jsonify(error="That doesn't look like an SVG."), 400
    if len(svg.encode("utf-8")) > MAX_STUDIO_SVG:
        return jsonify(error="That drawing is too big to save."), 413
    name = studio_file_name(body.get("name"))
    if name is None:
        return jsonify(error="Give the drawing a name."), 400
    folder = allowed_path(body.get("folder")) if body.get("folder") else DRAWINGS_FOLDER
    if folder is None or not folder.is_dir():
        return jsonify(error="That isn't a folder the app can save drawings in."), 403
    path = folder / name
    # Saving over a drawing keeps what Plot wrote into it. Plot's block - where the drawing sits, its
    # scale, the inks, links and order chosen for plotting it - is Plot's, and Studio only knows the
    # fresh defaults it writes into a new file. Replacing the block would undo every one of those
    # choices each time the drawing was edited.
    if path.exists():
        try:
            from lxml import etree
            kept = read_plot(parse_svg(path).getroot())
            if kept is not None:
                root = etree.fromstring(svg.encode("utf-8"), etree.XMLParser(huge_tree=True))
                write_plot(root, kept)
                svg = etree.tostring(root, encoding="unicode", xml_declaration=False)
        except Exception:  # noqa: BLE001 - an unreadable old file is simply replaced, as before
            pass
    try:
        tmp = path.with_name(f".{path.name}.studio-saving")
        tmp.write_text(svg, encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        return jsonify(error=f"Couldn't save {name}: {exc.strerror or exc}"), 500
    return jsonify(name=path.name, path=str(path), folder=display_path(folder))


@app.delete("/api/printed")
def clear_printed():
    """
    Forget which layers have been plotted. "Printed this session" is a note to the operator about
    what has already gone on the paper, and only the operator knows when that stops being true - a
    new sheet, a pen swapped, a plot abandoned halfway. It clears itself when a different drawing is
    opened; this is for the times the drawing stays and the paper doesn't.
    """
    forget_printed()
    return jsonify(ok=True, printed_layers=[])


@app.delete("/api/file")
def clear_file():
    if job.busy():
        return jsonify(error="Wait for the plotter to finish before clearing the drawing."), 409
    forget_printed()
    for path in (CURRENT_SVG, JOBS / "current.name", CURRENT_PATH, CURRENT_MTIME):
        path.unlink(missing_ok=True)
    clear_resume()
    with job.lock:
        if not job.busy():
            job.reset("idle")
    return jsonify(ok=True)


# Simulations run one at a time, newest first: a request that is still waiting when a newer one arrives
# is answered with superseded=true instead of being simulated. Two at once only slow each other down
# (the NextDraw software's planning is pure Python), and the page only wants the latest answer anyway.
estimate_lock = threading.Lock()
estimate_counter = {"latest": 0}


@app.post("/api/estimate")
def estimate():
    if not CURRENT_SVG.exists():
        return jsonify(error="Load an SVG first."), 400
    with printed_lock:  # any small lock will do for the counter
        estimate_counter["latest"] += 1
        mine = estimate_counter["latest"]
    with estimate_lock:
        if mine != estimate_counter["latest"]:
            return jsonify(superseded=True)
        try:
            body = request.json or {}
            result = dry_run(clean_settings(body), render=True, scale=clean_scale(body), layers=clean_layers(body), rotation=clean_rotation(body), hatch=clean_hatch(body))
            from lxml import etree
            result["layers"] = read_layers(etree.parse(str(CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot())
            return jsonify(result)
        except Exception as exc:
            return jsonify(error=f"Couldn't read that SVG: {exc}"), 400


@app.post("/api/artwork")
def artwork():
    """The drawing as it will be placed (sized, scaled, turned), without simulating the plot - fast, so
    the preview can update at once while /api/estimate works out the pen paths and timing."""
    if not CURRENT_SVG.exists():
        return jsonify(error="Load an SVG first."), 400
    try:
        body = request.json or {}
        from lxml import etree
        svg = svg_input(clean_scale(body), None, clean_rotation(body), clean_hatch(body))
        root = etree.parse(str(CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot()
        size_note = normalize_size(root)
        trimmed = bool((read_plot(root) or {}).get("original_page"))
        return jsonify(svg=svg, layers=read_layers(root), warnings=[size_note] if size_note else [], trimmed=trimmed)
    except Exception as exc:
        return jsonify(error=f"Couldn't read that SVG: {exc}"), 400


@app.post("/api/plot")
def plot():
    if not CURRENT_SVG.exists():
        return jsonify(error="Load an SVG first."), 400
    body = request.json or {}
    settings = clean_settings(body)
    placement = clean_placement(body)
    with job.lock:
        if job.busy():
            return jsonify(error="A plot is already running."), 409
        job.reset("preparing")
        job.thread = threading.Thread(target=run_plot, args=(settings, placement), daemon=True)
        job.thread.start()
    return jsonify(ok=True)


@app.post("/api/resume")
def resume_plot():
    resume = load_resume()
    if not resume:
        return jsonify(error="There's no stopped plot to resume."), 400
    # The drawing, placement and stopping point are the stopped plot's. The settings are the page's
    # current ones when it sends them, so changes made while stopped (Small paths, speeds, Handling mode,
    # a re-seated pen's heights) apply to the rest of the plot.
    settings = {**resume["settings"], **clean_settings(request.get_json(silent=True) or {})}
    with job.lock:
        if job.busy():
            return jsonify(error="A plot is already running."), 409
        job.reset("preparing")
        job.speed_pct = resume.get("speed_pct", 100)  # a plot slowed down before it stopped carries on slowed down
        job.thread = threading.Thread(
            target=run_plot, args=(settings, resume["placement"], resume), daemon=True)
        job.thread.start()
    return jsonify(ok=True)


@app.delete("/api/resume")
def discard_resume():
    """Forget the stopped plot and send the carriage home."""
    resume = load_resume()
    with job.lock:
        if job.busy():
            return jsonify(error="Wait for the plotter to finish first."), 409
        clear_resume()
        settings = clean_settings((resume or {}).get("settings") or request.json or {})
        job.reset("moving")
        job.thread = threading.Thread(target=run_manual, args=("home", settings, 0.0, None), daemon=True)
        job.thread.start()
    return jsonify(ok=True)


@app.get("/api/plot-paths")
def plot_paths():
    if not PLOT_PATHS.exists():
        return jsonify(error="There's no plot in progress."), 404
    return send_from_directory(JOBS, PLOT_PATHS.name, mimetype="image/svg+xml", max_age=0)


@app.post("/api/speed")
def set_speed():
    """
    Speed up or slow down the running plot (or the stopped one, for when it resumes), as a percentage
    of its tool's speeds. It applies from the next path, and a new plot starts back at 100%.
    """
    try:
        pct = int(round(float((request.get_json(silent=True) or {}).get("percent"))))
    except (TypeError, ValueError):
        return jsonify(error="Give the speed as a percentage."), 400
    pct = max(SPEED_PCT_RANGE[0], min(SPEED_PCT_RANGE[1], pct))
    with job.lock:
        if job.state in ("preparing", "plotting"):
            old = job.speed_pct
            job.speed_pct = pct
            if job.nd is not None:
                apply_live_speed(job.nd, job.plot_settings, pct)
                if job.started and job.estimate_s and old != pct:
                    # Roughly: the time left changes with the speed. (Acceleration makes it less than that.)
                    elapsed = time.time() - job.started
                    left = max(0.0, job.estimate_s - elapsed)
                    job.estimate_s = elapsed + left * old / pct
            return jsonify(speed_pct=pct)
        if job.busy():
            return jsonify(error="The plotter is finishing up."), 409
    resume = load_resume()
    if not resume:
        return jsonify(error="There's no plot to change the speed of."), 409
    resume["speed_pct"] = pct
    RESUME_META.write_text(json.dumps(resume))
    return jsonify(speed_pct=pct)


@app.post("/api/stop")
def stop():
    with job.lock:
        if job.state == "preparing":
            job.state = "stopping"
        elif job.state == "plotting":
            job.state = "stopping"  # relay_stop() sends the pause request to the plotter
    return jsonify(ok=True)


@app.post("/api/manual")
def manual():
    body = request.json or {}
    command = body.get("command")
    if command not in MANUAL_COMMANDS:
        return jsonify(error="Unknown command."), 400
    axis = body.get("axis")
    distance = 0.0
    if command == "walk":
        if not WALK_CLAMP_SUPPORTED:
            return jsonify(error="Moving the carriage is turned off: this NextDraw software version "
                                 "changed in a way that stops the range check from working."), 409
        if axis not in ("x", "y"):
            return jsonify(error="Choose a direction."), 400
        try:
            distance = max(-1000.0, min(1000.0, float(body.get("distance_mm", 0))))
        except (TypeError, ValueError):
            return jsonify(error="Enter a distance in millimeters."), 400
    settings = clean_settings(body.get("settings") or {})
    with job.lock:
        if job.busy():
            return jsonify(error="Wait for the plotter to finish what it's doing."), 409
        job.reset("testing" if command == "pen_test" else "moving")
        job.thread = threading.Thread(target=run_manual, args=(command, settings, distance, axis), daemon=True)
        job.thread.start()
    return jsonify(ok=True)


@app.get("/api/presets")
def list_presets():
    return jsonify(presets=resolve_presets(load_presets()))


@app.put("/api/presets/<name>")
def put_preset(name):
    name = name.strip()[:40]
    if not name:
        return jsonify(error="Give the preset a name."), 400
    settings = clean_preset_settings(request.json or {})
    existing = load_presets()
    marker, tip = find_preset(existing, name)
    if tip is not None:
        return save_tip(existing, marker, tip, settings, request.json or {})
    previous = marker or {}
    presets = [p for p in existing if p.get("name") != name]
    entry = {"name": name, "settings": settings}
    if previous.get("palette"):
        entry["palette"] = previous["palette"]  # the tool's colors, set up by hand in presets.json
    if previous.get("tilt"):
        entry["tilt"] = previous["tilt"]  # angle compensation, measured when the tool was set up
        # The Drawing tool card can set the measured offset; nothing else about the tilt changes there.
        try:
            offset = float((request.json or {})["tilt_offset_mm"])
            entry["tilt"] = {**previous["tilt"], "offset_mm": round(max(0.0, min(100.0, offset)), 2)}
        except (KeyError, TypeError, ValueError):
            pass
    # The barrel's width in mm where the clip holds it. A fat one moves the tip down the page.
    barrel = previous.get("barrel_mm")
    try:
        barrel = round(max(1.0, min(60.0, float((request.json or {})["barrel_mm"]))), 2)
    except (KeyError, TypeError, ValueError):
        pass
    if barrel:
        entry["barrel_mm"] = barrel
    if previous.get("drag"):
        entry["drag"] = previous["drag"]  # a soft tip that may only be pulled, never pushed
    if previous.get("hatch"):
        entry["hatch"] = previous["hatch"]  # the angle and line spacing this tool fills with
    presets.append(entry)
    presets.sort(key=lambda p: p["name"].lower())
    save_presets(presets)
    return jsonify(presets=resolve_presets(presets))


def save_tip(presets, marker, tip, settings, body):
    """Save one tip of a marker. Only what this tip does differently from the marker is written on
    it, so the two tips go on sharing everything they had in common - change the marker's handling
    and both still follow it. The measured numbers stay at whichever level already holds them."""
    shared = marker.get("settings") or {}
    tip["settings"] = {k: v for k, v in settings.items() if shared.get(k) != v}
    holder = tip if "tilt" in tip else marker
    if holder.get("tilt"):
        try:
            offset = float(body["tilt_offset_mm"])
            holder["tilt"] = {**holder["tilt"], "offset_mm": round(max(0.0, min(100.0, offset)), 2)}
        except (KeyError, TypeError, ValueError):
            pass
    try:
        barrel = round(max(1.0, min(60.0, float(body["barrel_mm"]))), 2)
        (tip if "barrel_mm" in tip else marker)["barrel_mm"] = barrel
    except (KeyError, TypeError, ValueError):
        pass
    save_presets(presets)
    return jsonify(presets=resolve_presets(presets))


def clean_palette(raw):
    """A tool's pen colors, as edited in the palette view: each one a name and a #rrggbb color."""
    colors = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("color"), str):
            continue
        if not HEX_COLOR.match(item["color"]):
            continue
        name = item.get("name") if isinstance(item.get("name"), str) else ""
        colors.append({"name": name.strip()[:40] or "Unnamed", "color": item["color"].lower()})
    return colors[:100]


@app.put("/api/presets/<name>/palette")
def put_palette(name):
    """Save the pen colors of one tool. An empty palette leaves the tool without one."""
    presets = load_presets()
    # Onto the marker, not the tip: the same ink comes out of both ends, which is the whole reason
    # they are one preset. A tip that was given a palette of its own keeps it.
    marker, tip = find_preset(presets, name.strip()[:40])
    preset = tip if (tip is not None and "palette" in tip) else marker
    if preset is None:
        return jsonify(error="That drawing tool isn't on this Mac."), 404
    colors = clean_palette((request.json or {}).get("palette"))
    # A tip that comes in only some of the marker's colours is editing a filtered view of the
    # marker's palette, so saving it must not take the others off the marker. What it saves is
    # folded back in - a colour it changed is changed for both, one it adds is added to the marker,
    # and one it drops is only dropped from what this tip is offered.
    if tip is not None and "colors" in tip:
        by_name = {c["name"]: c for c in colors}
        merged = [by_name.pop(c["name"], c) for c in (marker.get("palette") or [])]
        merged += by_name.values()  # colours this tip has that the marker hadn't heard of
        marker["palette"] = merged
        tip["colors"] = [c["name"] for c in colors]
        save_presets(presets)
        return jsonify(presets=resolve_presets(presets))
    if colors:
        preset["palette"] = colors
    else:
        preset.pop("palette", None)
    save_presets(presets)
    return jsonify(presets=resolve_presets(presets))


@app.delete("/api/presets/<name>")
def delete_preset(name):
    saved = load_presets()
    marker, tip = find_preset(saved, name)
    if tip is not None:
        marker["variants"] = [v for v in marker["variants"] if v is not tip]
        presets = saved if marker["variants"] else [p for p in saved if p is not marker]
    else:
        presets = [p for p in saved if p.get("name") != name]
    save_presets(presets)
    return jsonify(presets=resolve_presets(presets))


def lan_addresses():
    """How other devices on the network can reach this computer: its Bonjour name and its IP address."""
    names = []
    host = socket.gethostname()
    if host:
        names.append(host if host.endswith(".local") else f"{host}.local")
    try:
        # Connecting a UDP socket sends nothing; it only picks the interface that routes outward.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 80))
            names.append(probe.getsockname()[0])
    except OSError:
        pass
    return names


if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    lan = "--lan" in sys.argv
    url = f"http://{HOST}:{PORT}"
    print(f"NextDraw Plot running at {url}  (Ctrl+C to quit)")
    if lan:
        for name in lan_addresses():
            print(f"  On this network: http://{name}:{PORT}")
        print("  Anyone on this network can use the plotter and open drawings from the app's folders.")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    # "::" listens on IPv6 and IPv4 alike. Name.local resolves to IPv6 first, and Safari won't fall back.
    app.run(host="::" if lan else HOST, port=PORT, threaded=True)
