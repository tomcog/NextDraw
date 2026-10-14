#!/usr/bin/env python3
"""
Every app's Pen menu starts with None: the pen for a new or one-off tool.

The server makes it (server.py, none_tool). What has to hold:

- It comes first in the list, and until it's changed it is the plotter's EnerGel: its settings,
  hatch and barrel - but none of its colors, tilt or one-way strokes, which belong to a known pen.
- A change to it (Plot's HUD saves the tool) is kept as a preset named None, for that plotter only:
  the iDraw's None and the NextDraw's are two pens.
- Deleting it puts it back to EnerGel's, and leaves the other plotter's alone.

Run it from the repository:   .venv/bin/python tests/none_pen_is_energel_until_changed.py
It needs nothing running: no server, no plotter. The presets file is never touched.
"""
import copy
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

ENERGEL = {"name": "EnerGel", "settings": {"pen_pos_down": 30, "pen_pos_up": 60, "pen_width": 0.28},
           "barrel_mm": 11.44, "hatch": {"angle": 45, "spacing_mm": 0.35},
           "palette": [{"name": "Black", "color": "#231f20"}], "drag": True}
IDRAW_PEN = {"name": "iDraw pen", "plotter": "idraw", "settings": {"pen_pos_down": 50, "pen_pos_up": 20}}
store = {"presets": [copy.deepcopy(ENERGEL), copy.deepcopy(IDRAW_PEN), {"name": "Flair", "settings": {"pen_width": 0.4}}]}
server.load_presets = lambda: copy.deepcopy(store["presets"])
server.save_presets = lambda presets: store.update(presets=copy.deepcopy(presets))
plugged = {"now": "nextdraw"}
server.plotter_on_usb = lambda: plugged["now"]
client = server.app.test_client()

listed = client.get("/api/presets?plotter=connected").get_json()["presets"]
none = listed[0]
assert none["name"] == "None", [p["name"] for p in listed]
assert none["settings"] == ENERGEL["settings"] and none["hatch"] == ENERGEL["hatch"] and none["barrel_mm"] == 11.44
assert "palette" not in none and "drag" not in none, none
assert not any(p["name"] == "None" for p in store["presets"]), "not saved until it's changed"

# The HUD changes its down height: kept as the NextDraw's None.
r = client.put("/api/presets/None?plotter=connected", json={**ENERGEL["settings"], "pen_pos_down": 25})
assert r.status_code == 200, r.get_json()
saved = [p for p in store["presets"] if p["name"] == "None"]
assert len(saved) == 1 and saved[0]["settings"]["pen_pos_down"] == 25 and "plotter" not in saved[0], saved
assert saved[0]["hatch"] == ENERGEL["hatch"], "a change keeps what it was made from"
assert client.get("/api/presets?plotter=connected").get_json()["presets"][0]["settings"]["pen_pos_down"] == 25

# The iDraw's None is its own: from its own first tool, and a change to it leaves the NextDraw's.
plugged["now"] = "idraw"
idraw_none = client.get("/api/presets?plotter=connected").get_json()["presets"][0]
assert idraw_none["name"] == "None" and idraw_none["settings"] == IDRAW_PEN["settings"], idraw_none
assert client.put("/api/presets/None?plotter=connected", json={**IDRAW_PEN["settings"], "pen_pos_down": 45}).status_code == 200
nones = {p.get("plotter", "nextdraw"): p["settings"]["pen_pos_down"] for p in store["presets"] if p["name"] == "None"}
assert nones == {"nextdraw": 25, "idraw": 45}, nones

# Deleting the iDraw's puts it back to its first tool's, and the NextDraw's stays.
assert client.delete("/api/presets/None").status_code == 200
nones = {p.get("plotter", "nextdraw"): p["settings"]["pen_pos_down"] for p in store["presets"] if p["name"] == "None"}
assert nones == {"nextdraw": 25}, nones
assert client.get("/api/presets?plotter=connected").get_json()["presets"][0]["settings"]["pen_pos_down"] == 50
print("ok: None is EnerGel until changed, and each plotter's is its own")
