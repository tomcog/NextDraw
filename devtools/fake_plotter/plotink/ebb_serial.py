"""Finding plotters on the USB bus. The simulated one is always there unless it's switched off."""

from _ndsim.machine import machine


class SimulatedPort:
    description = "NextDraw (simulated)"
    device = "/dev/null"
    serial_number = "SIMULATED"

    def __str__(self):
        return self.description


def listEBBports():  # noqa: N802 - the real function is named this way
    return [SimulatedPort()] if machine.plugged_in else []
