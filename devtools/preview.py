"""
Run NextDraw Studio against a simulated plotter, for work on a machine with no NextDraw attached
(or no NextDraw software installed).

    .venv/bin/python devtools/preview.py

It puts devtools/fake_plotter on the import path ahead of everything else, so `import nextdraw`
in server.py finds the stand-in, then starts server.py exactly as it normally starts. Nothing in
server.py changes, and nothing here is imported when the app runs for real.

Options (environment variables):
    NEXTDRAW_SIM_SPEED=10      how many times faster than real time a simulated plot runs (1 = real time)
    NEXTDRAW_SIM_NO_PLOTTER=1  pretend nothing is plugged in, to work on the app's disconnected state
"""

import os
import runpy
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAKE = ROOT / "devtools" / "fake_plotter"


def seed_desktop():
    """
    The file browser only opens drawings from the Desktop (and iCloud Drive). A container has
    neither, so make a Desktop with the sample drawings in it to browse. An existing Desktop is
    left exactly as it is, so this does nothing at all on a real Mac.
    """
    desktop = Path.home() / "Desktop"
    if desktop.exists():
        return
    desktop.mkdir(parents=True)
    for sample in sorted((ROOT / "samples").glob("*.svg")):
        shutil.copy2(sample, desktop / sample.name)
    print(f"Made {desktop} and put the sample drawings in it, for the file browser.")


def main():
    seed_desktop()
    sys.path.insert(0, str(FAKE))
    os.environ.setdefault("NEXTDRAW_SIM_SPEED", "10")
    if "--no-browser" not in sys.argv:
        sys.argv.append("--no-browser")  # there's rarely a browser to open where this is useful
    print(f"Simulated plotter: {FAKE.relative_to(ROOT)} "
          f"(speed x{os.environ['NEXTDRAW_SIM_SPEED']}"
          f"{', nothing plugged in' if os.environ.get('NEXTDRAW_SIM_NO_PLOTTER') else ''})")
    sys.argv[0] = str(ROOT / "server.py")
    runpy.run_path(str(ROOT / "server.py"), run_name="__main__")


if __name__ == "__main__":
    main()
