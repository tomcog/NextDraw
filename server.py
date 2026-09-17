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
from plotink import ebb_serial  # noqa: E402

HOST, PORT = "127.0.0.1", 5055
ROOT = Path(__file__).parent
JOBS = ROOT / "jobs"
JOBS.mkdir(exist_ok=True)
CURRENT_SVG = JOBS / "current.svg"
CURRENT_MTIME = JOBS / "current.mtime"  # the file's modified time when opened or last saved, to catch outside edits
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
FOLDER_NAMES = {Path.home() / "Desktop": "Desktop"}
if ICLOUD_DRAWINGS.is_dir():
    FOLDER_NAMES[ICLOUD_DRAWINGS] = "iCloud Drawings"
for folder in ICLOUD_FOLDERS:
    if (ICLOUD_DRIVE / folder).is_dir():
        FOLDER_NAMES[ICLOUD_DRIVE / folder] = folder.title()
ALLOWED_FOLDERS = list(FOLDER_NAMES)
# Where Studio writes a new drawing: the shared iCloud folder when there is one, so it syncs to the
# other Mac like every other drawing, and otherwise whichever folder the browser lists first.
DRAWINGS_FOLDER = ICLOUD_DRAWINGS if ICLOUD_DRAWINGS.is_dir() else ALLOWED_FOLDERS[0]
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


def forget_printed():
    with printed_lock:
        printed_layers.clear()


def mark_printed(layer_id):
    """Record a plot that ran to the end: its one layer, or every shown layer when the whole drawing plotted."""
    try:
        root = parse_svg(CURRENT_SVG).getroot()
        ids = [layer_id] if layer_id else [g.get("id") for g in layer_groups(root) if g.get("id") and not layer_hidden(g)]
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


def only_layer(root, layer_id):
    """Hide every layer but one, so the NextDraw software plots just that layer (it skips display:none).
    The hidden layers stay in the document, so the page size and the preview's layer ids don't change."""
    groups = layer_groups(root)
    target = next((g for g in groups if g.get("id") == layer_id), None)
    if target is None:
        raise RuntimeError("The layer chosen to print isn't in the drawing anymore. Choose it again.")
    if layer_hidden(target):
        raise RuntimeError("The layer chosen to print is hidden. Show it to plot it.")
    for group in groups:
        if group is not target:
            set_layer_hidden(group, True)


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


def svg_input(scale, layer=None, rotation=0):
    """
    The loaded SVG for the NextDraw software: sized (see normalize_size) and scaled if needed. The
    software plots a document at its width/height, so scaling multiplies those while a viewBox keeps
    the artwork filling the page. Returns an SVG string (plot_setup accepts a path or a string).
    """
    from lxml import etree
    root = etree.parse(str(CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot()
    normalize_size(root)
    if layer:
        only_layer(root, layer)
    rotate_document(root, rotation)
    if abs(scale - 100) < 1e-9:
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
    # The one layer to plot, by id; None plots the whole drawing.
    placement["rotation"] = clean_rotation(raw)
    placement["layer"] = str(raw["layer"])[:200] if isinstance(raw.get("layer"), str) and raw["layer"] else None
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


def dry_run(settings, render, scale=100.0, source=None, mode="plot", layer=None, rotation=0):
    """Simulate the plot without the machine. Returns stats and (optionally) the path preview SVG."""
    log = []
    nd = make_nextdraw(log)
    nd.plot_setup(source if source is not None else prepared_svg(settings, scale, layer, rotation))
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


def prepared_svg(settings, scale, layer=None, rotation=0):
    """The loaded drawing ready to plot: placed and scaled, and drag-limited for a one-way tool."""
    svg = svg_input(scale, layer, rotation)
    return limit_drag(svg, settings) if settings.get("drag_only") else svg


def carriage_start(placement):
    """Where the carriage starts the plot, in mm from home: the drawing's place plus any tip offset."""
    return placement["x"] + placement.get("tip_offset_x", 0.0), placement["y"]


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
    root.set("data-y-mm", str(placement["y"]))
    PLOT_PATHS.write_bytes(etree.tostring(root))


def run_plot(settings, placement, resume=None):
    """Plot the loaded drawing, or resume a stopped plot (resume = its saved metadata)."""
    log = job.log
    try:
        if resume:
            source, mode = resume_source(settings), "res_plot"
        else:
            clear_resume()  # a new plot replaces any stopped one
            source = prepared_svg(settings, placement["scale"], placement.get("layer"), placement.get("rotation", 0))
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
            carriage.update(origin_known=True, origin_x=carriage_start(placement)[0], origin_y=placement["y"])
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
                mark_printed(placement.get("layer"))
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
            if not code:
                # "Return home" always runs the homing routine: its whole job is to put the carriage
                # on the corner, and the step count it would otherwise walk by is exactly what goes
                # wrong - a carriage pushed by hand, a missed step, an app restart that inherited the
                # plotter's homed flag. It is the one command that must not trust that count, even
                # though homing from far forward sweeps the carriage across the whole width.
                # A walk still only homes when the position isn't trusted yet.
                code = find_home_first(settings, log, force=(command == "home"))
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


@app.get("/")
def index():
    return send_from_directory(ROOT / "static", "index.html")


@app.get("/static/<path:name>")
def static_files(name):
    return send_from_directory(ROOT / "static", name)


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
    handling = [{"id": i, "name": models.handlers[i].name} for i in range(1, 5)]
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


def loaded_token():
    """The same, for the copy being worked on, written when it's opened or saved."""
    return CURRENT_HASH.read_text().strip() if CURRENT_HASH.exists() else None


def allowed_path(raw):
    """Resolve a path the page sent and make sure it's inside an allowed folder. Returns a Path or None."""
    try:
        path = Path(os.path.expanduser(str(raw))).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    for folder in ALLOWED_FOLDERS:
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
    folder = allowed_path(request.args.get("path") or ALLOWED_FOLDERS[0])
    if folder is None or not folder.is_dir():
        return jsonify(error="That folder isn't one the app can open drawings from."), 403
    folders, files = [], []
    try:
        entries = sorted(folder.iterdir(), key=lambda p: p.name.lower())
    except OSError as exc:
        return jsonify(error=f"Couldn't read that folder: {exc.strerror or exc}"), 400
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
    roots = [folder_root.resolve() for folder_root in ALLOWED_FOLDERS]
    parent = folder.parent if folder not in roots else None
    return jsonify(
        path=str(folder),
        display=display_path(folder),
        parent=str(parent) if parent else None,
        roots=[{"name": FOLDER_NAMES.get(root, root.name), "path": str(r)} for root, r in zip(ALLOWED_FOLDERS, roots)],
        folders=folders,
        files=files,
    )


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
    return jsonify(name=svg_path.name, path=str(svg_path), folder=display_path(svg_path.parent), plot=plot)


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
    what Plot is about to print.
    """
    path = allowed_path(request.args.get("path", ""))
    if path is None or not path.is_file() or path.suffix.lower() != ".svg":
        return jsonify(error="That isn't an SVG the app can open."), 403
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
            layer = body.get("layer") if isinstance(body.get("layer"), str) and body.get("layer") else None
            result = dry_run(clean_settings(body), render=True, scale=clean_scale(body), layer=layer, rotation=clean_rotation(body))
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
        svg = svg_input(clean_scale(body), None, clean_rotation(body))
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
    return jsonify(presets=load_presets())


@app.put("/api/presets/<name>")
def put_preset(name):
    name = name.strip()[:40]
    if not name:
        return jsonify(error="Give the preset a name."), 400
    settings = clean_preset_settings(request.json or {})
    existing = load_presets()
    previous = next((p for p in existing if p.get("name") == name), {})
    presets = [p for p in existing if p.get("name") != name]
    entry = {"name": name, "settings": settings}
    if previous.get("palette"):
        entry["palette"] = previous["palette"]  # the tool's colors, set up by hand in presets.json
    if previous.get("tilt"):
        entry["tilt"] = previous["tilt"]  # angle compensation, measured when the tool was set up
    if previous.get("drag"):
        entry["drag"] = previous["drag"]  # a soft tip that may only be pulled, never pushed
    if previous.get("hatch"):
        entry["hatch"] = previous["hatch"]  # the angle and line spacing this tool fills with
    presets.append(entry)
    presets.sort(key=lambda p: p["name"].lower())
    save_presets(presets)
    return jsonify(presets=presets)


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
    preset = next((p for p in presets if p.get("name") == name.strip()[:40]), None)
    if preset is None:
        return jsonify(error="That drawing tool isn't on this Mac."), 404
    colors = clean_palette((request.json or {}).get("palette"))
    if colors:
        preset["palette"] = colors
    else:
        preset.pop("palette", None)
    save_presets(presets)
    return jsonify(presets=presets)


@app.delete("/api/presets/<name>")
def delete_preset(name):
    presets = [p for p in load_presets() if p.get("name") != name]
    save_presets(presets)
    return jsonify(presets=presets)


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
