"""Plotting: what the machine is told, and what is told back (Tom, 2026-11-24).

The drawing prepared for the plotter - turned, scaled, hatches re-solved at the size it will really
be drawn, tiny paths dropped - then the plot itself: the job and its state, the carriage, going home,
resuming where a stop left off, and the queue of what to plot next.

This is the code that moves the machine. It knows the drawing and the driver; it knows nothing of
Flask, and the routes that drive it are in server.py, which imports from here.
"""
from flask import request
from lxml import etree
from nextdraw import NextDraw
from nextdrawcore import homing, serial_utils
from nextdrawcore.nextdraw_options import models
from pathlib import Path
import places
from places import (ICLOUD_DRIVE, IMPORT_SUFFIXES, LOCAL_QUEUE_FILE, PLOT_HISTORY, QUEUE_FILE)
from plotextras import add_plot_extras, registration_first
from plotink import ebb_serial
from state import state
from svgpaths import fill_runs, flatten_path_data, mm
from svgtree import NON_DRAWING_TAGS, LEGACY_PLOT_TAG, PLOT_TAG, INKSCAPE_NS, PX_PER_UNIT, STUDIO_FILL_PREFIX, SVG_NS, layer_groups, layer_hidden, normalize_size, page_mm_and_units, parse_svg, read_layers, set_layer_hidden, studio_fills
import copy
import hashlib
import json
import math
import os
import re
import threading
import time

# Not NextDraw options: either the app's own, or set somewhere other than nd.options (join_gap).
APP_ONLY_SETTINGS = {"pen_setup", "pen_width", "ink_opacity", "ink_builds", "ink_opaque", "ink_build", "drag_only", "join_gap"}

ERRORS = {
    101: "Couldn't connect to the plotter. Check that it's plugged in by USB and switched on.",
    102: "Paused with the button on the plotter.",
    103: "Stopped. The pen was raised where the plot paused.",
    104: "Lost the USB connection to the plotter during the plot.",
    105: "The plotter lost power during the plot.",
    106: "Homing failed. Check that nothing is blocking the carriage.",
}

# Layers that finished plotting since the drawing was loaded (ids). Kept on disk beside the jobs, so a
# restart doesn't wipe what has gone on the paper; cleared when another drawing is opened, or by hand.
printed_lock = threading.Lock()

def write_printed():
    """Called holding printed_lock."""
    try:
        places.PRINTED_FILE.write_text(json.dumps(sorted(printed_layers)))
    except OSError:
        pass  # the marks still hold until the app restarts

def read_printed():
    try:
        return set(json.loads(places.PRINTED_FILE.read_text()))
    except (OSError, ValueError, TypeError):
        return set()


printed_layers = read_printed()

# The settings every open Plot page shows - this Mac's screen and any other device's - so whichever
# screen you look at shows what a plot would use. On disk, so a restart keeps them. `version` changes
# with each change; the pages watch it through /api/status and fetch the settings when it moves.
PLOT_SETTINGS = places.JOBS / "plot-settings.json"

plot_settings_lock = threading.Lock()

def mark_printed(layer_ids):
    """Record a plot that ran to the end: its layers (one, or several linked to print together), or
    every shown layer when the whole drawing plotted."""
    try:
        root = parse_svg(places.CURRENT_SVG).getroot()
        ids = list(layer_ids) if layer_ids else [g.get("id") for g in layer_groups(root) if g.get("id") and not layer_hidden(g)]
    except Exception:  # noqa: BLE001 - a missing mark is not worth failing a finished plot over
        return
    with printed_lock:
        printed_layers.update(i for i in ids if i)
        write_printed()
        done = set(printed_layers)
    try:
        queue_mark_done_if_printed(root, done)
    except Exception:  # noqa: BLE001 - nor a state.queue mark
        pass

# The state.queue: drawings waiting their turn on the plotter, in the order they're to be plotted. One state.queue
# for every Mac and plotter: kept in iCloud Drive beside the presets, so a drawing queued on one Mac is
# there on the other, and one plotted to the end on either is marked done on both. A Mac without
# iCloud Drive keeps its own beside the jobs. Only the list - each drawing's own choices stay in the
# drawing. A drawing is marked done when every layer Plot would draw of it has plotted to the end; the
# page can tick or untick it by hand as well.
queue_lock = threading.Lock()

def queue_path_to_file(path):
    """A queued drawing's path as the file keeps it: from iCloud Drive or the home folder where it's in
    one, so it finds the same drawing on a Mac whose home folder has another name."""
    text = str(path)
    for prefix, root in (("icloud:", ICLOUD_DRIVE), ("~", Path.home())):
        if text.startswith(str(root) + "/"):
            return prefix + text[len(str(root)):]
    return text

def queue_path_from_file(text):
    """The other way: a kept path as it is on this Mac."""
    text = str(text)
    if text.startswith("icloud:"):
        return str(ICLOUD_DRIVE) + text[len("icloud:"):]
    return os.path.expanduser(text)

def queue_file_stamp():
    try:
        st = QUEUE_FILE.stat()
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None

def read_queue_file(path):
    """The drawings a state.queue file lists, with this Mac's paths, and its version. None if it can't be read
    (not there, or iCloud hasn't brought it down yet)."""
    try:
        saved = json.loads(path.read_text())
        items = []
        for i in saved.get("items", []):
            if isinstance(i, dict) and i.get("path"):
                where = Path(queue_path_from_file(i["path"]))
                items.append(queue_entry(where, i.get("id") or f"{time.time_ns():x}{len(items)}", i.get("done")))
        return {"items": items, "version": saved.get("version")}
    except (OSError, ValueError, AttributeError, TypeError):
        return None

def first_queue():
    """The state.queue at start: the shared one, or - the first time it's kept in iCloud Drive - this Mac's own
    from before, which then becomes the shared one."""
    shared = read_queue_file(QUEUE_FILE)
    if shared is not None or QUEUE_FILE == LOCAL_QUEUE_FILE:
        return shared or {"items": [], "version": None}
    own = read_queue_file(LOCAL_QUEUE_FILE)
    if own and own["items"]:
        return own  # written to iCloud Drive by the first sync_queue, which finds no file there
    return {"items": [], "version": None}

def queue_duplicates():
    """iCloud's copies of the queue file - "queue 2.json" - made when both Macs changed it at once."""
    try:
        return sorted(p for p in QUEUE_FILE.parent.glob("queue *.json") if re.fullmatch(r"queue \d+\.json", p.name))
    except OSError:
        return []

def sync_queue():
    """Catch up with the state.queue file, called holding queue_lock. Re-reads it when the other Mac has
    changed it, and folds in any copies iCloud made of it: a drawing either one lists is kept (in the
    file's order, the copy's extras after), and done if either says so. Better a drawing back in the
    state.queue than one lost."""
    if state.queue is None:
        state.queue = first_queue()
    dupes = queue_duplicates()
    stamp = queue_file_stamp()
    if stamp == state.queue_stamp and not dupes and stamp is not None:
        return
    shared = read_queue_file(QUEUE_FILE) if stamp is not None else None
    if shared is None:
        shared = state.queue  # not readable just now: keep what's held, and write it back if there's no file
    items = [dict(i) for i in shared["items"]]
    for dupe in dupes:
        other = read_queue_file(dupe)
        if other is None:
            continue
        by_path = {i["path"]: i for i in items}
        for i in other["items"]:
            if i["path"] in by_path:
                if i.get("done"):
                    by_path[i["path"]]["done"] = True
            else:
                items.append(dict(i))
                by_path[i["path"]] = items[-1]
    if dupes or (stamp is None and items):
        write_queue(items)  # the merge, or a state.queue the file doesn't have yet
    else:
        state.queue = {"items": items, "version": shared.get("version")}
        state.queue_stamp = stamp
    for dupe in dupes:
        try:
            dupe.unlink()  # folded in above
        except OSError:
            pass

def write_queue(items):
    """Called holding queue_lock."""
    state.queue = {"items": items, "version": f"{time.time_ns():x}"}
    try:
        QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
        kept = [{**i, "path": queue_path_to_file(i["path"])} for i in items]
        tmp = QUEUE_FILE.with_name(".queue.json.tmp")
        tmp.write_text(json.dumps({"items": kept, "version": state.queue["version"]}))
        os.replace(tmp, QUEUE_FILE)
        state.queue_stamp = queue_file_stamp()
    except OSError:
        pass  # the state.queue still holds until the app restarts

def queue_entry(path, item_id, done):
    return {"id": item_id, "path": str(path), "name": path.name, "folder": display_path(path.parent),
            "done": bool(done)}

def queue_mark_done_if_printed(root, printed):
    """The open drawing, if it's in the state.queue, is done once every layer Plot would draw is printed:
    not skipped (%), not hidden in the file, not held back in Plot's own block."""
    if not places.CURRENT_PATH.exists():
        return
    current = places.CURRENT_PATH.read_text()
    held = set((read_plot(root) or {}).get("hidden_layers") or [])
    wanted = [l["id"] for l in read_layers(root)
              if l["id"] and not l["skipped"] and not l["hidden"] and l["id"] not in held]
    if not wanted or not all(i in printed for i in wanted):
        return
    with queue_lock:
        sync_queue()
        items = state.queue["items"]
        if any(queue_is_open(i, current) and not i.get("done") for i in items):
            write_queue([{**i, "done": True} if queue_is_open(i, current) else i for i in items])

def queue_is_open(item, current):
    """Whether a queued drawing is the one open: an Illustrator or VectorCraft file opens as the SVG beside it."""
    path = Path(item["path"])
    return str(path) == current or (path.suffix.lower() in IMPORT_SUFFIXES and str(path.with_suffix(".svg")) == current)

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
        self.pen = None             # the tool and pen heights the plotter was given for this plot
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
            "pen": self.pen,
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

# The second plotter, an iDraw: a copy of the AxiDraw V3/A3 (library model 2: A3 travel, no automatic
# homing, a standard servo), geared 1.25 times finer and with its servo the other way up. It's told
# apart by the name "iDraw" stored on its board, which shows in its USB name ("EiBotBoard,iDraw"); any
# other board is the NextDraw. Its numbers come from the AxiDraw 2.7.0 software its makers modified.
# Its board needs firmware patched to skip the USB-power check; a stock update stops it connecting.
IDRAW = "idraw"

IDRAW_STEPS_PER_IN = 1270.0  # the library's native_res_factor is 1016

def plotter_of(ports):
    """Which plotter is on the USB, from the port listing: "idraw" for a board named iDraw, else "nextdraw"."""
    for port in ports or []:
        if str(port[1])[len("EiBotBoard,"):].strip().lower() == IDRAW:
            return IDRAW
    return "nextdraw"

def connected_plotter():
    return plotter_of(ebb_serial.listEBBports())

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

def svg_input(scale, layers=None, rotation=0, hatch=None, shift_mm=(0.0, 0.0), extras=None):
    """
    The loaded SVG for the NextDraw software: sized (see normalize_size) and scaled if needed. The
    software plots a document at its width/height, so scaling multiplies those while a viewBox keeps
    the artwork filling the page. Returns an SVG string (plot_setup accepts a path or a string).
    """
    from lxml import etree
    root = etree.parse(str(places.CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot()
    normalize_size(root)
    regenerate_hatches(root, hatch or {}, scale)
    # What Plot adds, before the layers are chosen: the blocks and the signature are layers like any
    # other, and the page grows for them whichever layer is being plotted - so every pass of a print
    # lands in the same place.
    made = dict(extras or {})
    add_plot_extras(root, made)
    if layers:
        only_layers(root, [layers] if isinstance(layers, str) else layers)
    registration_first(root, made.get("block_ids") or ())
    rotate_document(root, rotation)
    if abs(scale - 100) < 1e-9:
        shift_lines(root, shift_mm)
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
    shift_lines(root, shift_mm)
    return etree.tostring(root, encoding="unicode")

def make_nextdraw(log):
    """Create a NextDraw instance whose messages go to `log` instead of stdout."""
    def emit(text):
        text = str(text).strip()
        if text:
            log.append(re.sub(r"\s*\n+\s*", " ", text))
    nd = NextDraw(default_logging=False, user_message_fun=emit)
    if connected_plotter() == IDRAW:
        # Finer steps mean a lower top speed for the same motor step rate, so the speed limits are
        # scaled down with them. The library only works its speeds out again when the handling mode
        # changes, so it's told the handling has changed.
        scale = nd.params.native_res_factor / IDRAW_STEPS_PER_IN
        nd.params.native_res_factor = IDRAW_STEPS_PER_IN
        nd.params.speed_lim_xy_hr *= scale
        nd.params.speed_lim_xy_lr *= scale
        nd.params.handling_old = -1
        # The servo keeps the library's own timeout: it lets go a minute after the last move, so the
        # clip can be lifted by hand once a pen is seated (kept powered, it couldn't be, 2026-10-01).
        # Its own software's servo range; the heights are % of it, as they were there.
        nd.params.overrides = {**nd.params.overrides, "model_name": "iDraw", "servo_min": 7500, "servo_max": 28000}
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

def skip_tiny_paths(nd, mm, tally):
    """
    Leave out of this plot every pen stroke whose longest side is under mm on paper: marks so small
    the pen only dabs a dot. The NextDraw software has by now split the drawing into strokes (a hatch's
    lines, a compound shape's pieces) and joined the ends that touch, but not yet put them in order,
    so each stroke is judged on its own and Path order still applies to what's left. Only the plot's
    copy loses them; the drawing doesn't. A plot resumed from its saved digest is left as it was:
    its stopping point is a distance along the strokes it started with. Adds the count to tally["skipped"].
    """
    limit_in = mm / 25.4  # the digest is in inches on paper
    optimize = nd.randomize_optimize

    def without_tiny(first_copy=False):
        if first_copy and nd.digest is not None and nd.plot_status.resume.new.plob_version == "n/a":
            skipped = 0
            for layer in nd.digest.layers:
                kept = []
                for path in layer.paths:
                    points = [p for sub in (path.subpaths or []) for p in sub]
                    xs, ys = [p[0] for p in points], [p[1] for p in points]
                    if points and max(max(xs) - min(xs), max(ys) - min(ys)) < limit_in:
                        skipped += 1
                    else:
                        kept.append(path)
                layer.paths = kept
            tally["skipped"] = tally.get("skipped", 0) + skipped
        return optimize(first_copy)

    nd.randomize_optimize = without_tiny

def dry_run(settings, render, scale=100.0, source=None, mode="plot", layers=None, rotation=0, hatch=None, skip_tiny=None, extras=None):
    """Simulate the plot without the machine. Returns stats and (optionally) the path preview SVG."""
    log = []
    tally = {}
    if source is None:
        source = prepared_svg(settings, scale, layers, rotation, hatch, skip_tiny=skip_tiny, tally=tally, extras=extras)
    nd = make_nextdraw(log)
    if skip_tiny and mode == "plot":
        skip_tiny_paths(nd, skip_tiny, tally)
    nd.plot_setup(source)
    size_note = None
    if source is None and places.CURRENT_SVG.exists():
        from lxml import etree
        size_note = normalize_size(etree.parse(str(places.CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot())
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
        "skipped_tiny": tally.get("skipped", 0),
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

def limit_drag(svg_text, settings, skip_tiny=None, tally=None):
    """
    Rewrite the drawing so the tool is always pulled, never pushed. The NextDraw software flattens it
    to polylines for us (its digest), which it can also plot back as it stands, skipping the
    optimizations that would otherwise reorder or reverse what we just decided.
    """
    from lxml import etree
    nd = make_nextdraw([])
    if skip_tiny:  # here, as its digest is plotted as it stands
        skip_tiny_paths(nd, skip_tiny, tally if tally is not None else {})
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

def prepared_svg(settings, scale, layers=None, rotation=0, hatch=None, shift_mm=(0.0, 0.0), skip_tiny=None, tally=None, extras=None):
    """The loaded drawing ready to plot: placed and scaled, and drag-limited for a one-way tool. A
    one-way tool's tiny paths are left out here; anything else's as it plots (see skip_tiny_paths)."""
    svg = svg_input(scale, layers, rotation, hatch, shift_mm, extras)
    return limit_drag(svg, settings, skip_tiny, tally) if settings.get("drag_only") else svg

def plot_layers(placement):
    """The layers a placement plots. A stopped plot saved before layers could be linked has only `layer`."""
    return placement.get("layers") or ([placement["layer"]] if placement.get("layer") else None)

def carriage_start(placement):
    """Where the carriage starts the plot, in mm from home: the drawing's place plus the tilt offset
    along the width, less the barrel offset down the page (a thin barrel's is negative, so the carriage
    starts lower). The carriage can't start before home, so a drawing placed closer to the top or left
    than that - its empty margin may run past home - starts at home on that axis and its lines move
    up or left instead (lines_shifted_mm)."""
    return (max(0.0, placement["x"] + placement.get("tip_offset_x", 0.0)),
            max(0.0, placement["y"] - placement.get("tip_offset_y", 0.0)))

def lines_shifted_mm(placement):
    """How far the drawing's lines are moved left and up the page because the carriage couldn't start
    where the placement and the pen's offsets put it. Only what lies within this of the page's left or
    top edge is lost: the page's empty margin, or lines the tip couldn't reach anyway."""
    return (max(0.0, -(placement["x"] + placement.get("tip_offset_x", 0.0))),
            max(0.0, placement.get("tip_offset_y", 0.0) - placement["y"]))

def shift_lines(root, mm):
    """Move every drawing element left and up the page by `mm` (left, up), in the document's own units,
    the same way rotate_document turns them: a transform prepended to each top-level element."""
    left, up = mm
    if left <= 0 and up <= 0:
        return
    dx = dy = 0.0
    if left > 0:
        width_mm, units_wide = page_mm_and_units(root, "width", 2)
        dx = -left * units_wide / width_mm
    if up > 0:
        height_mm, units_high = page_mm_and_units(root, "height", 3)
        dy = -up * units_high / height_mm
    shift = f"translate({dx:g} {dy:g})"
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
    else:
        # Only the lines have to stay within reach, not the page's empty margin past them: with the page
        # the paper's size, a big sheet's page runs past the rails even where every line is in reach.
        # Measured as the software flattens them, which keeps them within the travel from the page's
        # corner - so placed at home what lies beyond is cut there, as it always was, and placed away
        # from home the far edge still shows how far the carriage would go.
        bounds = drawing_bounds(settings)
        if bounds:
            width, height = bounds[2], bounds[3]
    tol = 0.003
    start_x, start_y = carriage_start(placement)
    # Lines moved left or up to start at home end that much sooner.
    left, up = lines_shifted_mm(placement)
    start_x, start_y = start_x - left, start_y - up
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

def clear_resume():
    for path in (places.RESUME_SVG, places.RESUME_META, places.PLOT_PATHS):
        path.unlink(missing_ok=True)

def save_resume(svg_text, settings, placement, total_mm, speed_pct=100):
    """Keep a stopped plot's progress so it can be resumed. Returns the stopping point in mm."""
    m = re.search(r'pause_dist="(-?\d+)"', svg_text or "")
    pause_mm = int(m.group(1)) / 1000 if m else -1  # stored in µm
    if pause_mm <= 0:
        clear_resume()  # nothing drawn yet: starting over is the same as resuming
        return 0
    places.RESUME_SVG.write_text(svg_text)
    name_file = places.JOBS / "current.name"
    places.RESUME_META.write_text(json.dumps({
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
    svg_text = places.RESUME_SVG.read_text()
    handling = settings.get("handling")
    if not handling:
        return svg_text
    return re.sub(r'(<[^>]*plotdata\b[^>]*\bhandling=")\d+(")', rf"\g<1>{handling}\g<2>", svg_text, count=1)

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
    left, up = lines_shifted_mm(placement)
    root.set("data-x-mm", str(placement["x"] + left))
    root.set("data-y-mm", str(placement["y"] + up))
    places.PLOT_PATHS.write_bytes(etree.tostring(root))

def record_plot(event, placement, pen, done_mm=None):
    """One line in the plot history: when, what happened, the drawing, its layers, the tool and the
    pen heights it was given. Never stops a plot: a history that can't be written is only lost."""
    try:
        name_file = places.JOBS / "current.name"
        drawing = name_file.read_text().strip() if name_file.exists() else "?"
        ids = plot_layers(placement)
        layers = "all layers"
        if ids:
            from lxml import etree
            root = etree.parse(str(places.CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot()
            names = {l["id"]: l["name"] for l in read_layers(root)}
            layers = ", ".join(f"“{names.get(i, i)}”" for i in ids)
        line = (f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {event}: {drawing}, {layers}. "
                f"Tool {pen.get('tool') or 'not named'}: pen down {pen['down']}, up {pen['up']}, "
                f"lowering rate {pen['rate_lower']}")
        if done_mm is not None:
            line += f". {done_mm:.0f} mm drawn"
        with PLOT_HISTORY.open("a") as f:
            f.write(line + ".\n")
    except Exception:  # noqa: BLE001
        pass

def run_plot(settings, placement, resume=None):
    """Plot the loaded drawing, or resume a stopped plot (resume = its saved metadata)."""
    log = job.log
    try:
        if resume:
            source, mode = resume_source(settings), "res_plot"
        else:
            clear_resume()  # a new plot replaces any stopped one
            source = prepared_svg(settings, placement["scale"], plot_layers(placement), placement.get("rotation", 0),
                                  placement.get("hatch"), lines_shifted_mm(placement), placement.get("skip_tiny"),
                                  extras=placement.get("extras"))
            mode = "plot"

        # A new plot's simulation also draws its paths; a resumed plot keeps the ones saved when it began.
        skip_tiny = None if resume else placement.get("skip_tiny")
        estimate = dry_run(scaled_speeds(settings, job.speed_pct), render=not resume, source=source, mode=mode, skip_tiny=skip_tiny)
        if not resume and estimate["preview_svg"]:
            try:
                save_plot_paths(estimate["preview_svg"], placement)
            except Exception:  # noqa: BLE001 - only the "what's left" view goes without
                places.PLOT_PATHS.unlink(missing_ok=True)
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
        if skip_tiny:
            skip_tiny_paths(nd, skip_tiny, {})
        nd.plot_setup(source)
        apply_settings(nd, settings)
        nd.options.mode = mode
        pen = {"tool": placement.get("tool"), "down": nd.options.pen_pos_down, "up": nd.options.pen_pos_up,
               "rate_lower": nd.options.pen_rate_lower}
        record_plot(("Resumed" if resume else "Started"), placement, pen)
        go_to_plot_start(nd, placement)
        with job.lock:
            job.pen = pen
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
        state.last_plot_stopped = code in (102, 103)
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

        record_plot("Finished" if code == 0 else "Stopped" if code in (102, 103) else f"Error {code}", placement,
                    pen, job.done_mm)
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

def display_path(path):
    text = str(path)
    icloud = str(ICLOUD_DRIVE)
    if text == icloud or text.startswith(icloud + "/"):
        return "iCloud Drive" + text[len(icloud):]
    home = str(Path.home())
    return "~" + text[len(home):] if text.startswith(home) else text

# drawing_bounds, kept for each version of the drawing it measured - by the file's bytes and the
# plotter model - since the NextDraw software's flattening takes seconds on a big drawing. A change
# made here (reshape) moves the box it knows with the drawing, rather than measuring again.
_bounds_known = {}

def _bounds_key(data, settings):
    return hashlib.sha1(data).hexdigest(), settings.get("model")

def drawing_bounds(settings):
    """
    The box around every line in the drawing, in inches from the page's top-left, as the NextDraw
    software flattens it: all layers, hidden ones included, so every color is trimmed alike. Clipping
    masks aren't taken into account, so clipped artwork can make the box a little looser than what
    shows. Returns (x0, y0, x1, y1, page_w, page_h) or None when there are no lines.
    """
    from lxml import etree
    data = places.CURRENT_SVG.read_bytes()
    key = _bounds_key(data, settings)
    if key in _bounds_known:
        return _bounds_known[key]
    root = parse_svg(places.CURRENT_SVG).getroot()
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
    if len(_bounds_known) > 16:
        _bounds_known.clear()
    _bounds_known[key] = (min(xs), min(ys), max(xs), max(ys), vb[2], vb[3])
    return _bounds_known[key]
