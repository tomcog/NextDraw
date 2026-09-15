"""
The plotter and handling tables.

Only model 10 is known to be right: the repo's sample drawings give the NextDraw 2234 a reach of
34.02 x 23.39 in, and web/src/lib/constants.ts picks model 10 for it. Every other row is a
plausible stand-in, so the names carry "(simulated)" and the travels shouldn't be trusted.

To use the real table instead, run this on a Mac with the NextDraw software installed and drop the
result next to this file as models.json:

    .venv/bin/python devtools/dump_models.py > devtools/fake_plotter/nextdrawcore/nextdraw_options/models.json
"""

import json
from pathlib import Path

OVERRIDE = Path(__file__).with_name("models.json")


class Plotter:
    def __init__(self, model_name, travel_x, travel_y, auto_home=True):
        self.model_name = model_name
        self.travel_x = travel_x    # inches
        self.travel_y = travel_y
        self.auto_home = auto_home


class Handler:
    def __init__(self, name):
        self.name = name


plotters = {
    1: Plotter("Model 1, 11.8 x 8.6 in (simulated)", 11.81, 8.58),
    2: Plotter("Model 2, 16.9 x 11.7 in (simulated)", 16.93, 11.69),
    3: Plotter("Model 3, 23.4 x 8.6 in (simulated)", 23.42, 8.58),
    4: Plotter("Model 4, 6.3 x 4.0 in (simulated)", 6.30, 4.00),
    5: Plotter("Model 5, 34.0 x 23.4 in (simulated)", 34.02, 23.39),
    6: Plotter("Model 6, 23.4 x 17.0 in (simulated)", 23.39, 17.01),
    7: Plotter("Model 7, 7.5 x 5.5 in (simulated)", 7.48, 5.51),
    8: Plotter("NextDraw 8511 (simulated)", 11.81, 8.58),
    9: Plotter("NextDraw 1117 (simulated)", 17.01, 11.69),
    10: Plotter("NextDraw 2234 (simulated)", 34.02, 23.39),
}

handlers = {
    1: Handler("Standard (simulated)"),
    2: Handler("Smooth corners (simulated)"),
    3: Handler("Sharp corners (simulated)"),
    4: Handler("Gentle (simulated)"),
}

if OVERRIDE.is_file():  # the real tables, dumped from a machine with the NextDraw software
    try:
        data = json.loads(OVERRIDE.read_text())
        plotters = {int(k): Plotter(v["model_name"], v["travel_x"], v["travel_y"], v.get("auto_home", True))
                    for k, v in data.get("plotters", {}).items()}
        handlers = {int(k): Handler(v["name"]) for k, v in data.get("handlers", {}).items()}
    except (OSError, ValueError, KeyError, TypeError) as exc:  # noqa: BLE001 - fall back to the stand-ins
        print(f"fake plotter: ignoring {OVERRIDE.name} ({exc})")
