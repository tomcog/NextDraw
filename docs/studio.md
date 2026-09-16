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

- Studio is at `/studio`, wearing Plot's layout — a left rail of cards, and **the same canvas**.
  `BedCanvas` is shared: the plotter's bed at true scale, the paper on it, the one-inch grid, the
  dimension lines, home, and the plotter/paper/drawing zooms. Plot draws the drawing it is about to
  plot inside it; Studio draws the shapes it is editing. That is what stops the two previews drifting
  apart — one set of margins, one text size, one set of zooms — and it is the piece a third companion
  app would start from. It counts in bed units (100 per inch) because that is what Plot already used;
  Studio works in inches and scales at the boundary.
- Rectangle, ellipse and line, drawn by dragging on the page. One-inch grid, home marked in the
  corner the plotter starts from. The tools are their own card and what's been drawn is another,
  Layers, listing each shape with its real size - the same split Plot has between choosing a tool and
  working on the drawing.
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

**Opening a drawing again**, so handing one to Plot isn't the same as losing it. `GET
/api/studio/read` hands back a file's SVG without loading it, which matters: picking something to
edit can't change what Plot is about to print. Studio reads back the shapes it writes - rectangles,
ellipses, lines - converting from the drawing's own units. Plot's file browser does the picking,
given an endpoint to use, rather than Studio growing one of its own.

Studio also remembers the drawing it was last on, so coming back from Plot picks it up rather than
landing on a blank page. If that fails it says so and keeps the pointer: the file may be fine and the
server merely unreachable, and discarding the only record of what you were working on is the one
move you can't undo.

**A drawing Studio only partly understands can't be overwritten.** Saving rewrites a file from the
shapes Studio holds, so a drawing with 100 hatch paths in it would come back with none. Opening one
counts what it can't redraw and says so, and saving over that same name is refused - a different name
saves a copy and leaves the original alone. Studio owning the files it makes was never a licence to
gut someone else's artwork.

**Shapes can be edited after they're drawn.** Select is its own tool, not a modifier: with a drawing
tool chosen the shapes let a drag through to the page, so a shape covering the page is never a hole
you can't draw in, and a drag over one is never ambiguous. In select mode the whole shape is the
grip, interior included - these have no fill, so otherwise only the outline itself would catch the
pointer. Corner handles resize a box, and a line's two ends move independently. Drawing a shape
hands over to select, because what you want next is nearly always to nudge the thing you just drew.

A move is limited as a whole rather than corner by corner: clamping each point on its own would
squash a shape against the edge of the page instead of stopping it there.

**Undo and redo**, on the buttons and on the usual keys, except while typing in the name field where
those keys belong to the text. History keeps whole copies of the drawing rather than a list of
changes: a drawing is a handful of shapes, so a copy costs nothing and no replayed change can go
wrong. The one thing that needs care is that a drag makes hundreds of updates and has to undo as a
single step, so the canvas says when a gesture *starts* and history records once, there. Opening a
drawing clears the history - that's a new document, not a change to this one.

**Parametric hatch fills**, built to the decisions above. A shape can be given a fill with an angle
and a spacing; the lines are generated from those, so they follow the shape as it's moved or resized
and they change the moment a number does. Rectangles and ellipses can be filled - a line has no
interior. The lines are clipped to the shape properly: a box by its slabs, an ellipse by squashing it
to a circle and solving.

A new fill starts from the measured numbers in Plot's presets rather than something invented here, so
a fill opens at the Faber-Castell Brush's 45° and 1.711 mm. Spacing is stored as what it measures on
paper, with the plot scale it was generated for beside it, which is the part that lets a fill be
regenerated rather than merely redrawn.

Saving writes a fill twice over: as the lines the pen will draw, in a group named after the shape
they fill, and as the parameters that made them in an `<nds:design>` block. Reading it back skips the
generated lines - otherwise a fill would come back as hundreds of separate line shapes, cut loose
from the fill that made them - and regenerates from the parameters. Plot rewrites its own
`<nds:plot>` block on save and leaves `<nds:design>` alone, so the numbers survive a trip through it.

Page size lives behind an icon in the Drawing card rather than taking a card of its own.

**A fill can be hatched without its outline.** The shape still has to be in the file, because the
fill is regenerated from it - so it goes on the `%sources` layer, which is what that mechanism was
designed and tested for. NextDraw skips it, Plot strikes it through and leaves it out of the drawing's
bounds, and Studio shows it dashed and faint: you can still see and grab the thing the hatching comes
from, but it can't be mistaken for a line the pen will make. Reading a drawing back takes the outline
setting from which layer the shape is on rather than from the recorded flag, because the layer is
what actually decides whether a shape reaches the paper.

This needed one change in Plot: a `%` layer no longer counts towards "this drawing has more than one
layer, choose one to plot". Only one of them can be plotted, so there was nothing to choose.

**Cross-hatch** is a second fill on the same shape, starting square to the first because that is what
makes it read as a mesh rather than as two hatchings sharing a shape. Each pass keeps its own angle
and spacing, so a dense diagonal can be crossed with a sparse vertical.

Adding it moved one thing: whether the outline is drawn is a property of the *shape*, not of a fill.
With two fills there was no sensible owner for it. Reading a drawing back still takes that setting
from the layer the shape sits on, so nothing about the format changed.

**Colour belongs to the layer, never to the shape.** A layer is one pen: it holds as many shapes as
you like and every one of them plots in that single colour, because plotting a layer is exactly what
a pen change is for. This is the model Plot has and the model the machine has.

*Worth stating because the first attempt got it backwards*: a pen was put on each shape and layers
were derived at save time by grouping shapes of the same colour. That produces a similar-looking file
but it isn't the same thing — it makes "the colour of this shape" the real state and the layer an
artifact, so there is no way to say "these twelve shapes are one pen" and nothing for Plot's Layers
card to correspond to.

**Plot's drawing tools are Studio's too.** The tool is chosen from `/api/presets` rather than
duplicated, which is what the single-server decision was for. Three things follow from it:

- **A layer is named after the pen that draws it**, and choosing a pen from the swatch renames the
  layer with it. Names are the contract: Plot colours a layer from the pen whose name it matches, so
  a drawing arrives already coloured. The Layers card is the library's own `LayerController`, the
  same row Plot's Layers card is built from. The chosen tool goes in the `<nds:plot>` block too, so
  Plot opens the drawing with the same one.
- **Lines are drawn at the pen's real width.** A 0.7 mm EnerGel and a 1.41 mm brush are visibly
  different on the page, which is the only way to see whether a hatch spacing will read as lines or
  close up into a solid. That width is in the page's units, not screen pixels - the point is the true
  weight - while the interface drawn over it (guides, the shape being dragged out, handles) stays a
  screen hairline.
- **A fill starts from the chosen tool's own measured hatch numbers.**

A shape whose outline isn't drawn sits on `%sources`, which can't be named after a pen - it has to
keep the name NextDraw skips. Which layer it belongs to is recorded in the `<nds:design>` block
instead, **by layer name rather than by Studio's internal id**: those ids mean nothing once a file is
reopened, and an earlier version matched them up by position, which came out wrong the moment the
shapes and the layers were in different orders.

Layers are read back from the groups themselves rather than from the shapes inside them. A layer
holding nothing but a hatch fill has no shape to be found by - the generated lines are skipped on the
way past - so building the list from shapes loses that layer entirely.

Cards in the panel fold away, and remember whether they were folded. A panel of six cards is mostly
things you aren't using at this moment.

What it deliberately doesn't do yet: give the two passes of a cross-hatch different pens, which is
most of what two colours of cross-hatching would be for.
