"""
The simulated plotter itself: the state a real machine keeps between commands.

One instance stands in for the hardware for as long as the server runs, because the app opens a
new NextDraw connection for every command and expects the machine to remember where it is, whether
it has been homed, and what its plot-start offset is.
"""

import os
import threading

# The NextDraw counts motor steps in a CoreXY arrangement: one motor turns for x + y, the
# other for x - y. 2032 steps per inch is the usual 16x microstepping figure.
STEPS_PER_INCH = 2032.0


def _flag(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _number(name, default):
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


class Machine:
    def __init__(self):
        self.lock = threading.RLock()
        self.plugged_in = not _flag("NEXTDRAW_SIM_NO_PLOTTER")
        # How much faster than the real machine a simulated plot runs. 1 plots in real time.
        self.speed_factor = max(0.01, _number("NEXTDRAW_SIM_SPEED", 10.0))
        self.homed = False          # EBB variable 12: set by homing, cleared by a power cut
        self.x_in = 0.0             # position from the home corner, in inches
        self.y_in = 0.0
        self.offset_a = 0           # plot-start offset, in thousandths of a step
        self.offset_b = 0
        self.motors_on = False
        self.pen_up = True
        self.travel_x = 8.5         # replaced with the model's travel on every connection
        self.travel_y = 11.0

    # -- steps and inches ------------------------------------------------------------------
    def steps(self):
        """The two motor step counts for the current position."""
        with self.lock:
            a = (self.x_in + self.y_in) * STEPS_PER_INCH
            b = (self.x_in - self.y_in) * STEPS_PER_INCH
        return [int(round(a)), int(round(b))]

    def move_to(self, x_in, y_in):
        with self.lock:
            self.x_in = min(max(x_in, 0.0), self.travel_x)
            self.y_in = min(max(y_in, 0.0), self.travel_y)
            self.motors_on = True

    def offset_in(self):
        """The plot-start offset in inches."""
        with self.lock:
            a, b = self.offset_a / 1000, self.offset_b / 1000
        return ((a + b) / 2 / STEPS_PER_INCH, (a - b) / 2 / STEPS_PER_INCH)


machine = Machine()


def steps_for(x_in, y_in):
    a = (x_in + y_in) * STEPS_PER_INCH
    b = (x_in - y_in) * STEPS_PER_INCH
    return [int(round(a)), int(round(b))]


def inches_for(a_steps, b_steps):
    return ((a_steps + b_steps) / 2 / STEPS_PER_INCH, (a_steps - b_steps) / 2 / STEPS_PER_INCH)
