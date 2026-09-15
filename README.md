# NextDraw Studio

A local web app for plotting SVG files on a Bantam Tools NextDraw, built on
Bantam Tools' own [NextDraw Python API](https://bantam.tools/nd_py/).

- Preview the pen paths at true size on the plotter, with your paper, zoomed to the printer, paper or drawing
- Position a drawing by dragging it or by typing its start, and scale it by percentage
- Pick a drawing-tool preset (pen heights, lift and drop speeds, drawing speeds) from `presets.json`
- See plot time, line length and pen lifts, plus warnings about the drawing, before you start
- Watch progress while it plots, stop safely (the pen lifts), resume a stopped plot from where it
  stopped, and return home when it finishes
- Raise and lower the pen, move the carriage, send it home, and move the holder to the pen setup height

## Presets on more than one Mac

Drawing-tool presets (pen heights, speeds and color palettes) are kept in iCloud Drive, in
`iCloud Drive/NextDraw Studio/presets.json`, so every Mac signed in to the same iCloud account
shares them. The first time the app starts on a Mac with iCloud Drive, it copies `presets.json`
from the app folder there if the shared file doesn't exist yet. Later changes go only to the
iCloud copy; reload the page on the other Mac to pick them up. A Mac without iCloud Drive uses
`presets.json` in the app folder.

To add a palette, edit the preset in that file: a `palette` list of `{"name": ..., "color": "#rrggbb"}`.

## Pen heights

- **Height when drawing**: where the tip meets the paper.
- **Height when lifted (while moving)**: used for all pen-up travel. On a large plotter the arm
  droops toward its far end, so this is set higher than the setup height for clearance.
- **Pen setup height**: where the holder sits while you mount a pen with the manufacturer's sizing
  block. "Move to setup height" puts it there. It's an app setting, not a NextDraw option.

## Moving the carriage

The NextDraw software's own "walk" commands don't check the carriage's range of
motion. NextDraw Studio reads the carriage position from the plotter and shortens
any move that would go past the edge.

The app trusts the plotter's own record that it's homed, as the NextDraw software does.
"Release carriage" clears that record (the carriage may then be pushed by hand), and so
does a power loss; the next move then runs the homing routine, which finds the corner with
its limit switch. Otherwise "Return home" drives straight home, because homing from far
forward sweeps the carriage across the whole width first.

The pen is raised before any carriage move or homing, so a lowered pen is never
dragged across the paper.

Moving the carriage does not change where a plot starts. Placement is its own setting
(Drawing position, or drag the drawing in the preview): the app writes it to the plotter just
before plotting, and checks that the placed drawing stays within the plotter's reach, since the
NextDraw software only limits motion relative to the plot's start. After a finished plot the
carriage returns home (unless "Return home when finished" is off); a stopped plot leaves it
where it stopped.

## Stopping and resuming

When a plot is stopped (the Stop button, or the pause button on the plotter), the NextDraw software
records how far it got in a copy of the SVG. NextDraw Studio saves that copy to `jobs/resume.svg`,
with the settings, placement and scale in `jobs/resume.json`, so a stopped plot can be resumed even
after the app restarts. **Resume** puts the plot start back where it was (so the carriage can be
sent home in between) and continues from the stopping point, using the original settings.
**Discard stopped plot** forgets it and sends the carriage home; after that, Plot starts the drawing
from the beginning. Loading or clearing a drawing also discards a stopped plot (without moving
the carriage). A plot stopped before anything was drawn saves nothing.

Progress is measured by pen-down distance, the same measure the software uses to resume.

## Start

Double-click `start.command`. It opens http://127.0.0.1:5055 in your browser, and phones, tablets
and other computers on the same Wi-Fi can open it too, at the addresses it prints (this Mac's
`.local` name and its IP address). macOS may ask whether Python can accept incoming connections;
allow it. There's no login, so anyone on the network can drive the plotter and open or save
drawings in the app's folders. Use it on a network you trust.

`start.command` runs `server.py --lan`. To keep the app on this computer only, run it without the
flag:

```bash
.venv/bin/python server.py
```

## Set up from scratch

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd web && npm install && npm run build
```

## The page (web/)

The interface is a React + TypeScript app in `web/`, built with Vite, using components from
[`@tomcoggia/ui`](https://github.com/tomcog/component-library) (pinned by git tag in
`web/package.json`). Styles are CSS Modules on the library's `--ui-*` tokens; no Tailwind.

- `npm run build` (in `web/`) type-checks and writes the page to `static/`, which `server.py` serves.
- `npm run dev` (in `web/`) runs Vite on http://localhost:5173/static/ with hot reload, proxying
  `/api` to a running `server.py`.

The component library has no slider, so the range sliders are native inputs styled with its tokens,
alongside its `InputText`. The plotter preview and progress line are app-specific.

## Files

- `server.py` – Flask server that drives the plotter through the `nextdraw` package
- `web/` – source for the browser interface (React, `@tomcoggia/ui`)
- `static/` – the built interface (generated by `npm run build`; don't edit by hand)
- `samples/` – test drawings
- `jobs/` – the most recently loaded SVG (created automatically)
- `presets.json` – saved pen presets (created when you save one)

## Deployment notes

NextDraw Studio talks to the plotter over USB, so `server.py` has to run on the computer the
plotter is plugged into. The page it serves can be reached from other devices, but a copy of the
page hosted elsewhere (for example on a static host) can't reach the plotter by itself. Any web
deployment needs this server running next to the plotter, reachable through something like a
private network or a secure tunnel, and it has no login yet, so don't expose it publicly as is.

`static/` and `jobs/` are not in git: `static/` is built from `web/` (`npm run build`), and `jobs/`
holds the drawing currently loaded. `presets.json` (the saved drawing-tool presets) is committed.

