# Simulated plotter

A stand-in for the NextDraw software, so NextDraw Studio runs where there's no plotter plugged in
and no `nextdraw` package installed — a Linux container, a second Mac, an iPad session. The app
starts, loads drawings, previews pen paths, plots, stops, resumes and moves the carriage; the
"plotter" is Python.

```bash
.venv/bin/python devtools/preview.py     # then open http://127.0.0.1:5055
```

`server.py` is not changed or copied: `preview.py` puts `devtools/fake_plotter` first on the import
path, so `from nextdraw import NextDraw` finds the stand-in, and then runs `server.py` as it
normally runs. Nothing here is imported when the app runs for real.

Only Flask and lxml are needed:

```bash
python3 -m venv .venv && .venv/bin/pip install flask lxml
```

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `NEXTDRAW_SIM_SPEED` | `10` | How many times faster than real time a simulated plot runs. `1` plots in real time. |
| `NEXTDRAW_SIM_NO_PLOTTER` | unset | Pretend nothing is plugged in, to work on how the app behaves with no plotter. |

The times the app *shows* are the real estimates, so with a speed above 1 the plot finishes before
the countdown does.

On a machine with no Desktop folder, `preview.py` makes one and copies `samples/` into it, so the
file browser has something to open. An existing Desktop is never touched.

## What it simulates

- Flattens the SVG into the polylines a pen would draw: paths (including arcs and both kinds of
  curve), `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, nested transforms, `viewBox`
  scaling, and `display: none` layers left out, as the real software leaves them out.
- Line length, pen lifts, pen-up travel, path reordering, and a plot-time estimate.
- The path preview the app draws (the `% Preview` layer of pen-down and pen-up moves) and the
  flattened "plob" the app measures a drawing from, in inches.
- Plotting in (sped-up) real time, with progress by pen-down distance, stopping with the pen
  raised, and resuming from the stopping point through the same `pause_dist` record the real
  software writes into its output SVG.
- The machine state the app reads back between commands: homed or not, carriage position in motor
  steps, the plot-start offset, motors on or off, pen up or down — including the range check that
  shortens a walk at the edge of travel.

## What it doesn't

- **It is not the real motion planner.** Times come from a trapezoidal speed profile per move plus
  a servo delay per pen lift; they're in the right region for comparing settings, not for
  predicting the machine.
- No clipping masks, `<use>`, `<image>`, `<text>`, or CSS stylesheets. A stroke is one line down
  its middle, whatever its width.
- No USB, no EBB protocol, no error the real hardware would raise (a jam, a lost connection
  mid-plot, a power cut). `NEXTDRAW_SIM_NO_PLOTTER=1` is the only failure it can produce.
- **The plotter table is mostly invented.** Only model 10, the NextDraw 2234 at 34.02 x 23.39 in,
  is known to be right; every other model and all four handling modes are plausible stand-ins, and
  their names say "(simulated)". To use the real tables, run this on a Mac with the NextDraw
  software installed and commit the result:

  ```bash
  .venv/bin/python devtools/dump_models.py > devtools/fake_plotter/nextdrawcore/nextdraw_options/models.json
  ```

So: fine for working on the interface, the preview, placement, layers, presets, the file browser
and the plot/stop/resume flow. Not a substitute for testing a real plot on the real plotter.

## Layout

```
devtools/
  preview.py                  start server.py against the simulated plotter
  dump_models.py              dump the real plotter tables on a machine that has them
  fake_plotter/
    nextdraw/                 the package server.py imports NextDraw from
    nextdrawcore/             NextDraw class, homing, step offsets, plotter tables
    plotink/ebb_serial.py     finding plotters on the USB bus
    _ndsim/                   the simulation: SVG flattening, plot planning, SVG output, machine state
```
