"""
A stand-in for nextdrawcore.nextdraw.NextDraw: the same calls NextDraw Studio makes, answered by
the simulator instead of a machine over USB.

Only what server.py uses is here, and it behaves as server.py expects rather than as a faithful
copy of the real class. In particular the motion planning, time estimates and the plot preview are
approximations (see _ndsim/plan.py), and nothing checks the things a real machine would refuse.
"""

import threading
import time

from lxml import etree

from _ndsim import geometry, plan as planning, render
from _ndsim.machine import machine
from .nextdraw_options import models

# Error codes, as server.py's ERRORS table reads them.
NO_CONNECTION = 101
STOPPED = 103

# Modes that need the machine. Everything else is drawn from the file alone.
MACHINE_MODES = ("plot", "res_plot", "layers", "utility", "cycle", "align", "find_home", "manual", "toggle")


class Options:
    """The NextDraw options, with the defaults server.py assumes when it doesn't set one."""

    def __init__(self):
        self.mode = "plot"
        self.model = 10
        self.handling = 1
        self.speed_pendown = 25
        self.speed_penup = 75
        self.accel = 75
        self.pen_pos_down = 40
        self.pen_pos_up = 60
        self.pen_rate_lower = 50
        self.pen_rate_raise = 75
        self.copies = 1
        self.page_delay = 0
        self.reordering = 0
        self.auto_rotate = False
        self.random_start = False
        self.hiding = False
        self.preview = False
        self.rendering = 0
        self.digest = 0
        self.report_time = False
        self.utility_cmd = ""
        self.dist = 0.0
        self.const_speed = False


class Errors:
    def __init__(self):
        self.code = 0
        self.message = ""


class Stats:
    def __init__(self):
        self.down_travel_tot = 0.0   # inches drawn before this run (a resumed plot)
        self.down_travel_inch = 0.0  # inches drawn in this run
        self.up_travel_tot = 0.0
        self.up_travel_inch = 0.0


class PlotStatus:
    def __init__(self):
        self.stats = Stats()
        self.progress = None


class Physical:
    def __init__(self):
        self.z_up = True


class Pen:
    def __init__(self):
        self.phys = Physical()

    def pen_raise(self):
        self.phys.z_up = True
        machine.pen_up = True

    def pen_lower(self):
        self.phys.z_up = False
        machine.pen_up = False


class MachineInterface:
    """What server.py reads back from the plotter over the open port."""

    def __init__(self):
        self.port = None
        self.variables = {12: 0}

    def var_read(self, index):
        if self.port is None:
            return None
        if index == 12:
            return 1 if machine.homed else 0
        return self.variables.get(index, 0)

    def var_write(self, value, index):
        if self.port is None:
            return None
        if index == 12:
            machine.homed = bool(int(value))
        else:
            self.variables[index] = value
        return True

    def query_steps(self):
        if self.port is None:
            return None
        return machine.steps()


class Params:
    def __init__(self):
        self.travel_x = machine.travel_x
        self.travel_y = machine.travel_y


class HomingClass:
    """Homing and the plot-start offset. server.py wraps adjust_origin_offset to clamp walks."""

    def __init__(self, parent):
        self.parent = parent

    def find_home(self):
        machine.homed = True
        machine.move_to(0.0, 0.0)
        machine.offset_a = machine.offset_b = 0
        return True

    def adjust_origin_offset(self, delta_x, delta_y):
        """Move the carriage by (delta_x, delta_y) inches, taking the plot start with it."""
        with machine.lock:
            x, y = machine.x_in + delta_x, machine.y_in + delta_y
            machine.move_to(x, y)
            a, b = machine.steps()
            machine.offset_a += int(round(delta_x * 2032.0 + delta_y * 2032.0) * 1000)
            machine.offset_b += int(round(delta_x * 2032.0 - delta_y * 2032.0) * 1000)
        return True


class NextDraw:
    def __init__(self, default_logging=True, user_message_fun=None):
        self.options = Options()
        self.errors = Errors()
        self.plot_status = PlotStatus()
        self.machine = MachineInterface()
        self.pen = Pen()
        self.homing = HomingClass(self)
        self.params = Params()
        self.software_initiated_pause_event = None
        self._pause_requested = False
        self._message = user_message_fun if callable(user_message_fun) else None
        self._source = None
        self.time_estimate = 0.0
        self.distance_pendown = 0.0
        self.distance_total = 0.0
        self.pen_lifts = 0
        self.svg_width = 0.0
        self.svg_height = 0.0
        self.rotate_page = False

    # -- setup -----------------------------------------------------------------------------
    def plot_setup(self, svg_input=None):
        self._source = svg_input
        self.errors = Errors()
        self.plot_status = PlotStatus()
        self.software_initiated_pause_event = None
        self._pause_requested = False

    def say(self, text):
        if self._message:
            self._message(text)

    def disconnect(self):
        self.machine.port = None
        return True

    def transmit_pause_request(self):
        self._pause_requested = True
        if self.software_initiated_pause_event is not None:
            self.software_initiated_pause_event.set()

    # -- running ---------------------------------------------------------------------------
    def plot_run(self, output=False):
        mode = self.options.mode
        self.params = Params()
        model = models.plotters.get(int(self.options.model), models.plotters[10])
        machine.travel_x, machine.travel_y = model.travel_x, model.travel_y
        self.params.travel_x, self.params.travel_y = model.travel_x, model.travel_y

        if mode in MACHINE_MODES and not self.options.preview:
            if not machine.plugged_in:
                self.errors.code = NO_CONNECTION
                self.say("Failed to connect to NextDraw.")
                return None
            self.machine.port = "simulated"

        if mode in ("utility", "manual"):
            return self.utility_command()
        if mode == "find_home":
            self.homing.find_home()
            self.say("Homed.")
            return None
        if mode == "cycle":
            self.pen.pen_lower()
            time.sleep(0.3 / machine.speed_factor)
            self.pen.pen_raise()
            return None
        if mode == "align":
            machine.motors_on = False
            machine.homed = False
            self.pen.pen_raise()
            return None
        return self._plot(output)

    def utility_command(self):
        """
        The utility commands server.py uses. Walks go through adjust_origin_offset, which the app
        replaces with a version that keeps the move inside the plotter's travel.
        """
        command = self.options.utility_cmd
        if command == "raise_pen":
            self.pen.pen_raise()
        elif command == "lower_pen":
            self.pen.pen_lower()
        elif command == "walk_mmx":
            self.homing.adjust_origin_offset(self.options.dist / 25.4, 0.0)
        elif command == "walk_mmy":
            self.homing.adjust_origin_offset(0.0, self.options.dist / 25.4)
        elif command == "walk_x":
            self.homing.adjust_origin_offset(self.options.dist, 0.0)
        elif command == "walk_y":
            self.homing.adjust_origin_offset(0.0, self.options.dist)
        elif command == "walk_home":
            machine.move_to(0.0, 0.0)
            machine.offset_a = machine.offset_b = 0
        elif command == "read_name":
            self.say("NextDraw (simulated)")
        return None

    # -- plotting --------------------------------------------------------------------------
    def _drawing(self):
        """Flatten the loaded SVG. Returns (drawing, plan) or (None, None)."""
        source = self._source
        if source is None:
            return None, None
        if isinstance(source, bytes):
            source = source.decode("utf-8")
        parser = etree.XMLParser(huge_tree=True)
        try:
            if isinstance(source, str) and source.lstrip().startswith("<"):
                root = etree.fromstring(source.encode("utf-8"), parser)
            else:
                root = etree.parse(str(source), parser).getroot()
        except (etree.XMLSyntaxError, OSError) as exc:
            self.errors.code = 1
            self.say(f"Couldn't read the drawing: {exc}")
            return None, None
        drawing = geometry.flatten(root)
        if drawing is None:
            self.say("This drawing has no page size, so it can't be plotted.")
            return None, None
        self._root = root
        paths = planning.order_paths(drawing.paths, int(self.options.reordering))
        return drawing, planning.Plan(paths, self.options)

    def _plot(self, output):
        drawing, plot_plan = self._drawing()
        if drawing is None:
            return None

        self.svg_width, self.svg_height = drawing.width_in, drawing.height_in
        # Turn the page only when its orientation doesn't match the plotter's.
        self.rotate_page = bool(self.options.auto_rotate) and (
            (drawing.width_in > drawing.height_in) != (self.params.travel_x > self.params.travel_y))
        self.distance_pendown = plot_plan.pendown_in * 0.0254
        self.distance_total = (plot_plan.pendown_in + plot_plan.penup_in) * 0.0254
        self.pen_lifts = plot_plan.pen_lifts
        self.time_estimate = plot_plan.seconds
        if drawing.width_in > self.params.travel_x + 1e-3 or drawing.height_in > self.params.travel_y + 1e-3:
            self.say("The drawing is larger than the plotter's travel, so it would be clipped.")

        if self.options.digest:
            return render.plob_svg(drawing, plot_plan) if output else None
        if self.options.preview:
            if self.options.rendering and output:
                return render.preview_svg(self._root, drawing, plot_plan, int(self.options.rendering))
            return None

        return self._run_moves(plot_plan, output)

    def _run_moves(self, plot_plan, output):
        """Walk the plan in (sped-up) real time, so the app's progress bar has something to show."""
        source = self._source if isinstance(self._source, str) else ""
        already = render.read_progress(source) if self.options.mode == "res_plot" else 0.0
        self.plot_status.stats.down_travel_tot = already
        self.plot_status.stats.down_travel_inch = 0.0
        self.software_initiated_pause_event = threading.Event()
        if self._pause_requested:  # Stop arrived while the plot was being prepared
            self.software_initiated_pause_event.set()

        origin_x, origin_y = machine.offset_in()
        resume_at = plot_plan.time_for(already)
        started = time.monotonic()
        drawn = already

        while True:
            if self.software_initiated_pause_event.is_set():
                self.pen.pen_raise()
                self.errors.code = STOPPED
                self.say("Paused. The pen is up.")
                return render.progress_svg(source, drawn) if output else None

            when = resume_at + (time.monotonic() - started) * machine.speed_factor
            position, drawn_now, finished = plot_plan.state_at(when)
            drawn = max(already, drawn_now)
            self.plot_status.stats.down_travel_inch = drawn - already
            machine.move_to(origin_x + position[0], origin_y + position[1])
            if finished:
                break
            time.sleep(0.05)

        self.pen.pen_raise()
        self.plot_status.stats.down_travel_inch = plot_plan.pendown_in - already
        self.errors.code = 0
        self.say("Plot finished.")
        return render.progress_svg(source, 0) if output else None
