#!/usr/bin/env python3
"""
A marker with more than one tip is one preset, and still two tools.

Some markers come with two tips - two ends of the same pen, or the same ink in a second barrel. They
share everything that makes them that marker: the palette, the barrel the clip holds, how the pen is
handled. What differs is the tip: how wide it draws, how far the pen drops, what it hatches at,
whether it is held at a tilt. Kept as a preset each, the menu grew a line per tip and the palette had
to be edited twice; kept as one preset with variants, the marker is said once.

The catch is that a preset's NAME is an identity, not a label. It is written into every drawing that
was made with it, it is what /api/presets/<name> is routed on, and it is what Studio remembers. So
the nesting is only safe while it resolves back to the names that already exist: "Betem Acrylic" and
its "Fine" tip have to come out as "Betem Acrylic Fine", exactly as before, or every drawing made
with that pen quietly stops finding its tool.

This runs the real routes against a temporary presets file and checks that promise, along with the
four things that follow from it: a tip's settings are its own, the marker's are shared, the palette
belongs to the marker, and deleting a tip leaves its sibling alone.

Run it from the repository:   python3 tests/a_marker_with_two_tips_is_one_preset.py
It needs nothing running: no server, no plotter.
"""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

# One marker with two tips, and a plain preset beside it that has no tips of its own.
SHARED = {"handling": 1, "speed_pendown": 45, "speed_penup": 75, "pen_pos_up": 65}
PALETTE = [{"name": "Black", "color": "#262626"}, {"name": "Red", "color": "#d6322b"}]
NESTED = [
    {
        "name": "Betem Acrylic", "barrel_mm": 11.0, "palette": PALETTE, "settings": SHARED,
        "variants": [
            {"name": "Dot", "settings": {"pen_width": 1.7, "pen_pos_down": 30},
             "hatch": {"spacing_mm": 1.8}},
            {"name": "Fine", "settings": {"pen_width": 0.7, "pen_pos_down": 24},
             "hatch": {"spacing_mm": 0.706, "angle": 45},
             "tilt": {"on": True, "fixed": True, "angle": 45, "offset_mm": 66.5}},
        ],
    },
    {"name": "EnerGel", "settings": {**SHARED, "pen_width": 0.35}, "palette": PALETTE},
]

failures = []


def check(what, got, want):
    if got == want:
        print(f"  ok    {what}")
    else:
        failures.append(what)
        print(f"  FAIL  {what}\n          wanted {want!r}\n          got    {got!r}")


def main():
    tmp = Path(tempfile.mkdtemp()) / "presets.json"
    tmp.write_text(json.dumps(NESTED, indent=2))
    server.PRESETS_FILE = tmp
    server.ensure_presets_file = lambda: None
    client = server.app.test_client()
    tools = lambda r: {p["name"]: p for p in r.get_json()["presets"]}

    print("the names a drawing records")
    got = tools(client.get("/api/presets"))
    check("a tip is named marker-then-tip, as it always was",
          sorted(got), ["Betem Acrylic Dot", "Betem Acrylic Fine", "EnerGel"])

    print("\nwhat belongs to the tip, and what to the marker")
    check("each tip draws its own width",
          [got["Betem Acrylic Dot"]["settings"]["pen_width"], got["Betem Acrylic Fine"]["settings"]["pen_width"]],
          [1.7, 0.7])
    check("a tip takes the marker's settings where it says nothing",
          got["Betem Acrylic Dot"]["settings"]["speed_pendown"], 45)
    check("the tilt is the Fine tip's alone", "tilt" in got["Betem Acrylic Dot"], False)
    check("both tips draw the same colours",
          got["Betem Acrylic Dot"]["palette"] == got["Betem Acrylic Fine"]["palette"], True)
    check("a marker with no tips is unchanged", got["EnerGel"].get("variant"), None)

    print("\nediting one tip leaves the other alone")
    edited = {**got["Betem Acrylic Dot"]["settings"], "speed_pendown": 61}
    after = tools(client.put("/api/presets/Betem Acrylic Dot", json=edited))
    check("the edited tip took the change", after["Betem Acrylic Dot"]["settings"]["speed_pendown"], 61)
    check("its sibling did not", after["Betem Acrylic Fine"]["settings"]["speed_pendown"], 45)
    check("the sibling kept its tilt", after["Betem Acrylic Fine"].get("tilt", {}).get("offset_mm"), 66.5)
    check("the widths stayed each its own",
          [after["Betem Acrylic Dot"]["settings"]["pen_width"], after["Betem Acrylic Fine"]["settings"]["pen_width"]],
          [1.7, 0.7])
    marker = next(p for p in json.loads(tmp.read_text()) if p["name"] == "Betem Acrylic")
    check("only what differs is written on the tip",
          sorted(next(v for v in marker["variants"] if v["name"] == "Dot")["settings"]),
          ["pen_pos_down", "pen_width", "speed_pendown"])

    print("\na tip that comes in only some of the colours")
    marker = next(p for p in json.loads(tmp.read_text()) if p["name"] == "Betem Acrylic")
    marker["palette"] = [{"name": "Black", "color": "#262626"}, {"name": "Red", "color": "#d6322b"},
                         {"name": "Yellow", "color": "#fee338"}]
    next(v for v in marker["variants"] if v["name"] == "Fine")["colors"] = ["Black", "Yellow"]
    tmp.write_text(json.dumps([marker] + [p for p in json.loads(tmp.read_text()) if p["name"] != "Betem Acrylic"], indent=2))
    got = tools(client.get("/api/presets"))
    check("the whole marker's colours for the tip that has them",
          [c["name"] for c in got["Betem Acrylic Dot"]["palette"]], ["Black", "Red", "Yellow"])
    check("only its own for the tip that doesn't",
          [c["name"] for c in got["Betem Acrylic Fine"]["palette"]], ["Black", "Yellow"])
    check("in the marker's order, not the order they were named",
          [c["color"] for c in got["Betem Acrylic Fine"]["palette"]], ["#262626", "#fee338"])

    print("\nediting a restricted tip's palette leaves the marker whole")
    edit = [{"name": "Black", "color": "#111111"}, {"name": "Green", "color": "#054d17"}]
    after = tools(client.put("/api/presets/Betem Acrylic Fine/palette", json={"palette": edit}))
    check("the colour it changed changed for both",
          next(c["color"] for c in after["Betem Acrylic Dot"]["palette"] if c["name"] == "Black"), "#111111")
    check("the colour it dropped is still the marker's",
          [c["name"] for c in after["Betem Acrylic Dot"]["palette"]], ["Black", "Red", "Yellow", "Green"])
    check("but is no longer offered for that tip",
          [c["name"] for c in after["Betem Acrylic Fine"]["palette"]], ["Black", "Green"])

    print("\nthe palette is the marker's")
    one = [{"name": "Only", "color": "#123456"}]
    after = tools(client.put("/api/presets/Betem Acrylic Dot/palette", json={"palette": one}))
    check("set on an unrestricted tip, that tip has it",
          after["Betem Acrylic Dot"]["palette"], one)

    print("\ndeleting a tip")
    after = tools(client.delete("/api/presets/Betem Acrylic Dot"))
    check("the other tip stays", sorted(after), ["Betem Acrylic Fine", "EnerGel"])
    after = tools(client.delete("/api/presets/Betem Acrylic Fine"))
    check("the marker goes with its last tip", sorted(after), ["EnerGel"])

    print()
    if failures:
        print(f"{len(failures)} of the promises broken.")
        sys.exit(1)
    print("PASS - a marker is said once, and its tips are still tools.")


if __name__ == "__main__":
    main()
