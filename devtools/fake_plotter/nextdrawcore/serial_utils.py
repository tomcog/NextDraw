"""The plot-start offset kept in the plotter, in thousandths of a step."""

from _ndsim.machine import machine


def write_step_offsets(nd, a, b):
    with machine.lock:
        machine.offset_a, machine.offset_b = int(a), int(b)
    return True


def read_step_offsets(nd):
    with machine.lock:
        return [int(machine.offset_a), int(machine.offset_b)]
