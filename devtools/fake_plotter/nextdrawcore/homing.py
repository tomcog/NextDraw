"""
Positions in motor steps, as server.py converts between them.

The two motors are geared CoreXY-style: one counts x + y, the other x - y. Offsets are kept in
thousandths of a step, which is why server.py divides a read offset by 1000 before asking for
its position in inches.
"""

from _ndsim.machine import STEPS_PER_INCH


def xy_to_step_pos(nd, x_milli_inches, y_milli_inches):
    """Thousandths of an inch to the step offsets stored in the plotter (thousandths of a step)."""
    a = (x_milli_inches + y_milli_inches) * STEPS_PER_INCH
    b = (x_milli_inches - y_milli_inches) * STEPS_PER_INCH
    return [int(round(a)), int(round(b))]


def steps_to_xy_pos(nd, a_steps, b_steps):
    """Motor steps to a position in inches from the home corner."""
    return ((a_steps + b_steps) / 2 / STEPS_PER_INCH,
            (a_steps - b_steps) / 2 / STEPS_PER_INCH)
