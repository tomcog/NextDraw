# NextDraw Studio — design notes

Studio is a planned companion app: it creates and edits drawings, Plot prints them. None of it is
built. This is the record of what was decided in discussion on 2026-09-16 and, more usefully, why —
so that building it starts from those conclusions instead of re-deriving them.

Mark the difference as you read: **Decided** is settled, **Open** is a leaning with a question still
attached. Several Open items are cheap to answer now and expensive to answer later.

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

**One Flask process, two front-ends.** The button in Plot that opens a drawing in Studio is then a
plain link (`http://odin.local:5056/edit?path=…`).

*Why, and what was rejected:* a custom URL scheme (`nextdraw-edit://`) launches on the device you're
*viewing* from, which is the wrong machine when you're on the iPad. A server-side `open -a` launches
on odin, where you can't see it. A link works from anywhere, needs no registration and no subprocess.
The bigger payoff is that Studio then reads `pen_width`, `drag` and the palettes from the existing
`/api/presets` instead of keeping a second copy of numbers that would silently drift — and the
failure mode of drift is hatching that looks right on screen and comes out wrong on paper.

**Live reload rides the existing poll.** The page already polls `/api/status` every 2 s (500 ms while
plotting), and that payload already carries an mtime change-token for `plot_paths` purely so the page
knows to refetch — the same shape works for the drawing itself. Plot also already stat()s the disk
file into `CURRENT_MTIME` and detects external edits; today it only refuses to save ("was changed by
another app"). On reload, take the fast `/api/artwork` path and debounce the slow `/api/estimate`.
Suppress reload entirely while `job.busy()` or a resume record exists. Hash the content rather than
trusting mtime — the drawings live in iCloud, so sync alone can touch it.

## Open

**Spacing is probably stored as what it should measure on paper**, not in document units, with
regeneration reading Plot's `plot.scale` from the same file.

Plot applies scale at plot time — `svg_input` multiplies the document's width and height while the
viewBox keeps the artwork filling the page — so it scales hatch spacing along with everything else.
At 30%, a fill generated at 0.7 mm lands at **0.21 mm** under a 0.7 mm pen: solid ink where an open
fill was designed, and the preview scales identically so nothing warns you. What's not settled is
whether the parameters carry the intended scale, or whether Plot warns that a fill is stale.

Rotation is harmless by comparison, but note a fill's angle is relative to the artwork, not the paper.

**Does `drawing_bounds` exclude `%` layers?** It un-hides every layer before measuring (`server.py`),
then asks the NextDraw software to flatten the document. If `%` layers survive that flattening, a
`%sources` layer would quietly inflate the drawing's footprint and throw off Trim to drawing — which
would undermine the whole "sources ride along in the same file" approach. **Test this before
building anything on it**: it's ten minutes with a throwaway file, and it's load-bearing.

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
