# NextDraw Plot — what belongs in Plot

The record of what was decided in discussion on 2026-11-23, and why, so that building it starts from
those conclusions instead of re-deriving them. **Decided** is settled; **Open** is a leaning with a
question still attached.

Revised on 2026-11-24, once the cards were built and looked at; the two revisions are marked below.
What the rule allows Plot to touch has not moved; where the controls live, and how much of a fact is
worth showing, has.

It settles a drift: Plot had grown controls that change the piece itself — scaling, turning, fitting
and cropping the artwork, the artboard's size, its margins, its surface colour. All of them rewrote
the drawing, from the one app that should never touch it.

## The rule

A setting belongs in Plot only if it changes **where and whether the piece lands on paper**. A
setting that changes **how the piece looks** belongs to Studio, or to Image. Where a card holds both,
the card is split by the rule rather than moved whole — with two deliberate exceptions, below.

## Decided

**Plot never resizes anything.** No Scale, no Fit, no Fill. The artboard plots at its true size: 12 ×
12 in the file is 12 × 12 on the paper. Too big for the sheet is a red outline and a trip back to
Studio, not a number to turn down here. There is no proof-print scale.

**The Paper card's "Drawing transform" goes.** Studio's Artwork card already turns, fits, fills and
scales the artwork, which is where that work belongs; Plot's copy was a duplicate that edited the
file. Fill in particular scaled the artwork and then *cropped the strokes* at the margin.

**The Artboard card stays in Plot, read-only.** Size, margins and surface colour are shown so you can
see what you are plotting; none of them can be changed here.

> **Revised 2026-11-24 — the artboard is one line, not a card.** Built, this was Studio's whole
> Artboard section with every control disabled: four margin fields you couldn't type in and five
> colour swatches you couldn't press. It looked broken, and it told you nothing Plot acts on. The
> margins drive nothing in Plot — the only place the app reads them is to render those fields, and
> the marks grow the page around the artboard rather than sitting inside them. So what remains is
> the artboard's **size**, stated on one line, because it is the fact that matters at the machine:
> it is what has to fit the sheet. The **surface colour** moves to the Paper card, stated the same
> way, because there it answers "which sheet do I load". Read-only is unchanged — Plot still
> changes none of it.

**The Pen card stays whole, and the preview follows it.** It is an exception to the rule, and a
considered one: the preset is how the lines look — colours, line width, which the preview must show
so aesthetic decisions can be made — *and* how the plotter behaves, with pen-up and pen-down heights
and speeds that Plot cannot do without. Changing the preset in Plot updates the preview exactly as it
would anywhere else.

**The Layers card stays whole, ink included.** Which layers plot and in what order is plotting. So is
reassigning a layer's ink: a new preset may not have the colour the piece was drawn with, or you may
simply decide at the machine to try a lighter green. The preview shows the change.

**Trim marks, colour blocks and the signature stay.** Plot prints them; they are not part of the
piece.

**The paper is always long edge along the plotter's X.** Assumed, not offered — the Paper card's
which-way-it-lies switch goes, and the paper becomes just a size.

**Turning the artboard is Plot's, and it is placement only.** Nothing is written to the file.

- By hand, whenever you like, even when the piece would fit either way.
- By itself, only when the artboard does not fit as it lies but fits turned.
- A turn you set by hand stands. If it then doesn't fit, the outline goes red rather than Plot
  turning it back.

**One card, "Plot position", for putting the artboard on the sheet.**

> **Revised 2026-11-24 — it is the Layout card, and it holds two of these five things.** Layout is
> the same question in all three apps: how big the piece is, where it sits, which way it lies, none
> of it touching the artwork. Plot's Artboard card is called Layout now, as Studio's and Image's
> are, and placing the artboard is the whole of its body, under no heading of its own. As a card of
> its own it sat in the rail's lower group beside the plotter's own controls, away from the two
> cards it is entirely about, and read as missing.
>
> Of the five things listed below, **two remain**: the quarter turns, and one pair of Across and
> Down. Those two numbers are now measured **from the plotter's home**, not from the paper's corner,
> because that is the one thing Plot's Layout does: say where the artboard starts in relation to the
> plotter's origin. Gone with the rest:
>
> - the **nine-way align picker**, which was only a quick way of computing those two numbers;
> - the **margin**, which existed only to feed the align picker;
> - the second pair, **"where the paper's corner sits, from home"**. `paper_x` and `paper_y` are
>   still kept per drawing and still place the sheet in the preview and in `fitsOnPaper` - they
>   simply have no control any more. If a sheet needs taping somewhere other than home, that offset
>   goes into the one pair of numbers instead.
>
> The original five:

- the quarter turns;
- the nine-way align picker Studio's Artwork card uses — corners, edges and centre — acting as it is
  pressed rather than waiting for a Fit;
- one margin, a single number for all four sides, which the align insets by. The old "extra margin on
  one side" goes: a deeper foot is the artboard's own margin now, set in Studio;
- Across and Down, which become **the artboard's corner measured from the paper's corner**. They
  measure the lines from the plotter's home today.

**An SVG made elsewhere takes its page size as its artboard.** A drawing made in NextDraw carries an
artboard, its margins and its surface; a foreign SVG carries a page size and strokes, and the page
size is artboard enough to place it. No trip to Studio first.

## The cards, as built

Plot's rail, after 2026-11-24:

    file · layout · paper · pen · queue · marks
    —
    options · utilities

- **Layout** — the artboard's size on a line, then the quarter turns and one pair of Across and
  Down: the artboard's corner from the plotter's home. Nothing else.
- **Paper** — the sheet's size, and which colour of it to load.
- The lower group is the plotter's own again.

## What this leaves to build

The preview, the footprint and the fits-on-bed and fits-on-paper checks read the drawing as it is
written. A turn that is placement only means they must apply it instead — `footprint()` already
carries a `rotated` flag for it, and the driver has `auto_rotate`, which the server always sends off
today.

## Open

- Where the turn is kept. The placement already lives in the drawing's plot block, saved per drawing
  and not in the artwork; the turn would naturally join it. The block still has `scale` and
  `rotation` fields from before, which Plot currently bakes into the drawing when it opens one that
  has them (`plot/App.tsx`, applyChoices) — that bake has nothing left to do once Plot stops
  reshaping, but what should happen to a drawing that still carries an old scale isn't settled.
- Whether a layer's ink reassigned in Plot is written into the drawing, as Plot's layer inks are
  today, or kept with the plot's own choices.
- Whether "the paper's corner from home" wants a control again. It was taken off the Layout card on
  2026-11-24 with the align picker it served; the value is still kept and still used. Utilities is
  where the rest of the machine's facts live, if it comes back.
