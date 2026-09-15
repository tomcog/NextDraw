"""
Print the real plotter and handling tables as JSON, for the fake plotter to use.

Run it on a machine with the NextDraw software installed:

    .venv/bin/python devtools/dump_models.py > devtools/fake_plotter/nextdrawcore/nextdraw_options/models.json
"""

import json

from nextdrawcore.nextdraw_options import models

print(json.dumps({
    "plotters": {str(i): {"model_name": p.model_name, "travel_x": p.travel_x,
                          "travel_y": p.travel_y, "auto_home": p.auto_home}
                 for i, p in models.plotters.items()},
    "handlers": {str(i): {"name": h.name} for i, h in models.handlers.items()},
}, indent=2))
