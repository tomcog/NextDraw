"""
NextDraw Studio: a local web GUI for the Bantam Tools NextDraw Python API.

Run:  .venv/bin/python server.py
Then open http://127.0.0.1:5055
"""

import inspect
import json
import logging
import re
import sys
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
PRESETS_FILE = ROOT / "presets.json"

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
BOOL_SETTINGS = {"auto_rotate", "random_start", "hiding"}

# What a pen preset remembers. Paper size is chosen separately and isn't part of a preset.
PRESET_NUMERIC = {
    "pen_pos_down", "pen_pos_up", "pen_setup", "pen_rate_lower", "pen_rate_raise",
    "speed_pendown", "speed_penup", "accel", "handling",
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

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024


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
        self.started = None
        self.ended = None
        self.log = []

    def busy(self):
        return self.state in ("preparing", "plotting", "stopping", "returning", "testing", "moving")

    def snapshot(self):
        done = self.done_mm
        if self.nd is not None and self.state in ("plotting", "stopping"):  # live progress
            stats = self.nd.plot_status.stats
            inches = stats.up_travel_tot + stats.down_travel_tot + stats.up_travel_inch + stats.down_travel_inch
            done = min(inches * 25.4, self.total_mm) if self.total_mm else inches * 25.4
            self.done_mm = done
        end = self.ended or time.time()
        return {
            "state": self.state,
            "message": self.message,
            "done_mm": round(done, 1),
            "total_mm": round(self.total_mm, 1),
            "estimate_s": round(self.estimate_s),
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
    for key in BOOL_SETTINGS:
        if key in raw:
            settings[key] = bool(raw[key])
    return settings


def clean_scale(raw):
    """Drawing scale in percent (1-1000), default 100."""
    try:
        return max(1.0, min(1000.0, float(raw.get("scale", 100))))
    except (TypeError, ValueError):
        return 100.0


# Length units the SVG spec allows on width/height, in CSS px (user units when there's no viewBox).
PX_PER_UNIT = {"": 1.0, "px": 1.0, "in": 96.0, "mm": 96 / 25.4, "cm": 96 / 2.54, "pt": 96 / 72, "pc": 16.0}


def svg_input(scale):
    """
    The loaded SVG for the NextDraw software, scaled if needed. The software plots a document at its
    width/height, so scaling multiplies those while a viewBox keeps the artwork filling the page.
    Returns a file path (unscaled) or an SVG string (plot_setup accepts either).
    """
    if abs(scale - 100) < 1e-9:
        return str(CURRENT_SVG)
    from lxml import etree
    root = etree.parse(str(CURRENT_SVG), etree.XMLParser(huge_tree=True)).getroot()
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
        if key != "pen_setup":  # not a NextDraw option
            setattr(nd.options, key, value)


def dry_run(settings, render, scale=100.0):
    """Simulate the plot without the machine. Returns stats and (optionally) the path preview SVG."""
    log = []
    nd = make_nextdraw(log)
    nd.plot_setup(svg_input(scale))
    apply_settings(nd, settings)
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
        "warnings": log,
        "preview_svg": output if render else None,
    }


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
    if placement["x"] / 25.4 + width > model.travel_x + tol or placement["y"] / 25.4 + height > model.travel_y + tol:
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
        a, b = homing.xy_to_step_pos(nd, placement["x"] / 25.4 * 1000, placement["y"] / 25.4 * 1000)
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


def run_plot(settings, placement):
    log = job.log
    try:
        estimate = dry_run(settings, render=False, scale=placement["scale"])
        problem = placement_problem(settings, placement, estimate)
        if problem:
            with job.lock:
                job.state, job.message = "error", problem
            return
        with job.lock:
            job.total_mm = estimate["total_m"] * 1000
            job.estimate_s = estimate["estimate_s"]
        code = set_plot_start(settings, log, placement)
        if code:
            with job.lock:
                job.state = "error"
                job.message = ERRORS.get(code, f"The plotter reported error code {code}.")
            return
        with job.lock:
            carriage.update(origin_known=True, origin_x=placement["x"], origin_y=placement["y"])
            job.message = ""

        nd = make_nextdraw(log)
        nd.plot_setup(svg_input(placement["scale"]))
        apply_settings(nd, settings)
        with job.lock:
            job.nd = nd
            if job.state == "stopping":  # Stop was pressed while preparing
                job.state, job.message = "stopped", "Stopped before the plot started."
                job.ended = time.time()
                return
            job.state = "plotting"
            job.started = time.time()
        threading.Thread(target=relay_stop, args=(nd,), daemon=True).start()
        nd.plot_run()
        code = abs(nd.errors.code or 0)
        with job.lock:
            job.nd = None
            carriage["known"] = False
            carriage["pen_up"] = True if code in (0, 102, 103) else None
            job.snapshot()
            job.ended = time.time()
            if code == 0:
                job.done_mm = job.total_mm
                job.state = "returning" if placement["return_home"] else "finished"
                job.message = "Plot finished." if not placement["return_home"] else "Returning home…"
            elif code == 103:
                job.state, job.message = "stopped", ERRORS[103]
            else:
                job.state = "stopped" if code == 102 else "error"
                job.message = ERRORS.get(code, f"The plot ended with error code {code}.")

        if code == 0:
            if placement["return_home"]:
                # walk_home moves home and clears the plot-start offset.
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
    """
    model = settings.get("model", 8)
    if not models.plotters[model].auto_home or (carriage["verified"] and not force):
        return 0
    if not force:
        # Trust the plotter's own homed flag, as the NextDraw software does. It's cleared when
        # the plotter loses power, and this app clears it on "Release carriage".
        flag = []
        code = run_setup_step(settings, log, "utility", "read_name",
                              after=lambda nd: flag.append(nd.machine.var_read(12)))
        if code:
            return code
        if flag and flag[0]:
            with job.lock:
                carriage["verified"] = True
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
                # Run the homing routine only if the position can't be trusted yet. Otherwise go
                # straight home: homing from far forward sweeps the carriage across the whole width.
                code = find_home_first(settings, log)
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

        if command == "walk" and not code:
            # Walks shift the plotter's origin offset. Clear it so moving the carriage
            # doesn't change where the next plot starts (placement is a separate setting).
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


def load_presets():
    try:
        data = json.loads(PRESETS_FILE.read_text())
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def save_presets(presets):
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


@app.get("/api/info")
def info():
    model_list = [
        {"id": i, "name": models.plotters[i].model_name,
         "travel_in": [models.plotters[i].travel_x, models.plotters[i].travel_y],
         "auto_home": models.plotters[i].auto_home}
        for i in (8, 9, 10, 1, 2, 3, 4, 5, 6, 7)
    ]
    handling = [{"id": i, "name": models.handlers[i].name} for i in range(1, 5)]
    return jsonify(models=model_list, handling=handling, walk_supported=WALK_CLAMP_SUPPORTED)


@app.get("/api/status")
def status():
    with job.lock:
        snap = job.snapshot()
        snap["carriage"] = dict(carriage)
    snap["plotter_found"] = bool(ebb_serial.listEBBports())
    name_file = JOBS / "current.name"
    snap["file"] = name_file.read_text() if CURRENT_SVG.exists() and name_file.exists() else None
    return jsonify(snap)


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
    CURRENT_SVG.write_bytes(data)
    (JOBS / "current.name").write_text(file.filename)
    with job.lock:
        if not job.busy():
            job.reset("idle")
    return jsonify(name=file.filename)


@app.delete("/api/file")
def clear_file():
    if job.busy():
        return jsonify(error="Wait for the plotter to finish before clearing the drawing."), 409
    for path in (CURRENT_SVG, JOBS / "current.name"):
        path.unlink(missing_ok=True)
    with job.lock:
        if not job.busy():
            job.reset("idle")
    return jsonify(ok=True)


@app.post("/api/estimate")
def estimate():
    if not CURRENT_SVG.exists():
        return jsonify(error="Load an SVG first."), 400
    try:
        body = request.json or {}
        return jsonify(dry_run(clean_settings(body), render=True, scale=clean_scale(body)))
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
    presets = [p for p in load_presets() if p.get("name") != name]
    presets.append({"name": name, "settings": settings})
    presets.sort(key=lambda p: p["name"].lower())
    save_presets(presets)
    return jsonify(presets=presets)


@app.delete("/api/presets/<name>")
def delete_preset(name):
    presets = [p for p in load_presets() if p.get("name") != name]
    save_presets(presets)
    return jsonify(presets=presets)


if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    url = f"http://{HOST}:{PORT}"
    print(f"NextDraw Studio running at {url}  (Ctrl+C to quit)")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host=HOST, port=PORT, threaded=True)
