# NextDraw Studio — design notes

Studio is the companion app: it creates and edits drawings, Plot prints them. A first version is
built — see **Where it's got to**, at the end. The rest of this is the record of what was decided in
discussion on 2026-09-16 and, more usefully, why, so that building on it starts from those
conclusions instead of re-deriving them.

Mark the difference as you read: **Decided** is settled, **Open** is a leaning with a question still
attached. Where a decision rested on something testable, it was tested, and the result is recorded
beside it rather than left as an assumption.

Scope, in the order it's wanted: geometric shapes and hatch fills first, and editing SVGs made
elsewhere (hatching shapes, changing colors); later, generated paths — tracing a photo or logo,
converting images to lines.

## Decided

**One file, and Studio owns it.** Whatever Studio saves is the version to keep. There's no
obligation to preserve what the file looked like beforehand, and no separate plot-ready export.

**Fills are parametric, not baked.** A fill is its own object that *references* a shape and carries
its angle, spacing and pen.

*Why:* the spacing of hatch lines is a function of pen width, and the pens differ — 0.7 mm for the
EnerGel and the Flair, 1.41 mm for the Faber-Castell Brush. The same drawing also gets replotted at
different sizes. Both mean changing your mind after hatching is the normal case, not an edge case,
and a baked fill can only be redone by hand.

*Why a fill isn't a property of its shape:* a shape can only live on one layer, but one shape may
feed several fills — cross-hatching at two angles, or two colors that build up where they cross,
each needing its own layer and pen. If the shape owned the fill, the second one would have nowhere
to live.

**Source shapes ride along on a `%`-prefixed layer.** NextDraw skips layers whose names start with
`%`, and Plot already knows: it hides them from the preview and strikes them through in the Layers
list (`read_layers`, `server.py`). So the shapes stay in the same file, invisible and never plotted.
Once they live there, a shape's own layer stops meaning anything — it's a boundary in a drawer, and
the fills referencing it decide what colors it becomes.

*Tested 2026-09-16, because the whole approach depended on it.* `drawing_bounds` un-hides every layer
before measuring, so the worry was that a `%sources` layer would still inflate the drawing's footprint
and throw off Trim to drawing. It doesn't. On a test file with art at 1–2 in and a second layer at
5–7 in, the bounds came back `1, 1, 2, 2` — art only. The control matters: renaming that layer from
`%sources` to `sources` moved the bounds to `1, 1, 7, 7`, so it is the `%` doing the work and not a
quirk of the fixture. It holds whether the layer is hidden or not. The `%` geometry produced no
polylines at all in plot-mode flattening, which is also the proof that it would never be drawn.

**A per-fill bake button.** Drop the source and the parameters, keep the lines. Per fill, not per
file — one fill settled while another is still being tuned.

*Worth knowing:* baking is nearly free to implement, since it's just deleting things. So the
question isn't when to bake but why you'd ever need to. The honest reasons are file size on dense
work and — the real one — wanting to hand-edit the generated lines. That breaks regeneration anyway,
so "bake" and "let me edit these lines" are the same button wearing two hats.

**Layer names are the contract between the apps, not layer ids.** Studio should name fill layers
after palette entries ("Sepia", "Sky Blue") and emit them lightest-first.

*Why:* hatching regenerates geometry wholesale, so ids churn on every save. Names don't. Plot
already gives a layer whose name matches one of its tool's pens that pen's color (`0eb63af`), so
naming layers after pens makes colors carry across with no new plumbing, and emitting them
lightest-first means Plot's "Sort by darkness" is a no-op rather than a correction.

**One Flask process, two front-ends.** The button that moves a drawing between them is then a plain
link — Studio lives at `/studio` on the same server, so the handoff is one origin and no new port.

*Why, and what was rejected:* a custom URL scheme (`nextdraw-edit://`) launches on the device you're
*viewing* from, which is the wrong machine when you're on the iPad. A server-side `open -a` launches
on odin, where you can't see it. A link works from anywhere, needs no registration and no subprocess.
The bigger payoff is that Studio then reads `pen_width`, `drag` and the palettes from the existing
`/api/presets` instead of keeping a second copy of numbers that would silently drift — and the
failure mode of drift is hatching that looks right on screen and comes out wrong on paper.

**Both front ends live in this repo**, and in one `web/` folder: `index.html` is Plot, `studio.html`
is Studio, and one `npm run build` writes both into `static/`. Studio's code is `web/src/studio/`.
One repo, one install, one `start.command`, one deploy to odin.

*Why:* this follows from one Flask process rather than being a separate choice. A Studio in its own
repo would need either a second server — which gives up the shared presets and the plain-link handoff
that made the one-process decision worth making — or a repo that can't run on its own. Sharing one
`web/` folder goes further: one copy of `@tomcoggia/ui`, so the two apps cannot drift to different
versions of the design system, and Studio imports Plot's `Section`, `Header` styles and `api` helper
rather than owning near-copies of them. An earlier note in this file's commit history suggested
moving these notes out to a Studio repo later; that was written before this was thought through, and
it's wrong. They stay here.

**Live reload rides the existing poll.** The page already polls `/api/status` every 2 s (500 ms while
plotting), and that payload already carries an mtime change-token for `plot_paths` purely so the page
knows to refetch — the same shape works for the drawing itself. Plot also already stat()s the disk
file into `CURRENT_MTIME` and detects external edits; today it only refuses to save ("was changed by
another app"). On reload, take the fast `/api/artwork` path and debounce the slow `/api/estimate`.
Suppress reload entirely while `job.busy()` or a resume record exists. Hash the content rather than
trusting mtime — the drawings live in iCloud, so sync alone can touch it.

**Spacing is stored as what it should measure on paper**, in millimetres, not in document units.

*Why:* the number worth keeping is the one a pen has to live with, and that comes from the tool, not
from the drawing — 1.711 mm for the Faber-Castell Brush. Stored that way it means the same thing in
every file, so a tool's `hatch` entry in `presets.json` can seed a fill with no conversion at all.

*What follows:* Plot applies scale at plot time — `svg_input` multiplies the document's width and
height while the viewBox keeps the artwork filling the page — so generating a fill means dividing.
For spacing `s` on paper at scale `p`, the lines go `s / (p/100)` apart in document units: 1.711 mm
at 30% is drawn 5.70 mm apart in the file. Studio therefore has to read `plot.scale` out of the same
drawing before it generates anything.

The cost of getting this wrong is quiet. A fill generated at 0.7 mm and plotted at 30% lands at
**0.21 mm** under a 0.7 mm pen: solid ink where an open fill was designed, and the preview scales
identically, so it looks right until it's on paper.

Rotation is harmless by comparison — it's in 90° steps and doesn't scale anything — but note a fill's
angle is relative to the artwork, not the paper.

## Open

**What happens to a fill when Plot's scale changes.** Storing spacing in plotted millimetres means a
fill's generated lines are only correct at the scale they were made for. Change a drawing from 30% to
60% in Plot and every fill in it is silently half as dense as intended. Either Studio regenerates
every fill when it opens a drawing, or fills carry the scale they were generated at so Plot can say
one has gone stale, or both. Whichever way it goes, **the scale a fill was generated at has to be
stored next to its spacing** — that's what makes the staleness detectable at all, and it's cheap to
write now and impossible to recover later.

Worth remembering that a stale fill still plots. It's a quality problem, not an error, which argues
for a warning rather than a refusal.

## Changes Plot needs

These stand on their own, whether or not Studio gets built soon.

- `second_tool_layers` still keys layers by id, so every Studio save would orphan it. It should
  match on name, like the pen-color lookup already does.
- A drawing-changed token on `/api/status`, alongside the one `plot_paths` already uses.
- Per-tool hatch numbers are only recorded for the Faber-Castell Brush (45°, 1.711 mm). The EnerGel
  and the Flair have none; both are 0.7 mm pens and will want tighter spacing than the brush, but
  neither has been measured.

## Names

Until 2026-09-16 this repo was itself called NextDraw Studio. That name now belongs to the companion
app, and this one is NextDraw Plot. Three lowercase `studio`s survive on purpose: the legacy
`<nds:studio>` element that the read-both shim still opens, the `iCloud Drive/NextDraw Studio/`
folder that holds the drawings and presets, and the `localStorage` keys, which would reset the
remembered tool, placement, zoom and layers on every device if they moved.

## Where it's got to

A first version, built 2026-09-17: draw a shape, save it, open it in Plot.

- Studio is at `/studio`, wearing Plot's layout — a left rail of cards and a stage that sizes itself
  to the page the same way Plot's preview sizes itself to the drawing.
- Rectangle, ellipse and line, drawn by dragging on the page. One-inch grid, home marked in the
  corner the plotter starts from, shapes listed with their real size and deletable.
- Page size comes from the list Plot already offers, and can be turned.
- **Save** writes an SVG into the drawings folder through `POST /api/studio/save`. The drawing is
  sized in inches with a matching viewBox, its shapes sit in an Inkscape layer, and they're stroked
  and never filled, because the plotter draws lines and a fill would only make the preview lie.
- **Open in Plot** saves, calls `/api/open`, and goes to `/`. Nothing is passed in the URL: Plot
  already picks up whatever drawing is loaded when its page opens.
- The layer is named `Black`, which is not decoration — Plot colors a layer from the pen its name
  matches, so the drawing arrives already colored. The file also carries an `<nds:plot>` block naming
  the paper it was drawn for, so it doesn't land on whatever paper Plot was last set to.

Two colors are deliberately not Plot's tokens. Studio's page is white in both themes, so it uses an
on-white grey for the grid rather than `--nd-grid`, which is drawn on Plot's dark bed and goes
near-black; and shapes are drawn in the pen's own ink rather than `--nd-ink`, which is the blue Plot
uses for paths whose pen isn't known yet.

What it deliberately doesn't do yet: move or resize a shape once drawn, undo, open an existing
drawing for editing, choose a pen, or fill anything. Fills are the next feature, and the decisions
above are about them.
