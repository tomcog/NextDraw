# NextDraw Photo

Photo turns a photograph into lines for one drawing tool's pens. Its output is an ordinary layered
drawing, which Plot plots and Studio opens. It split out of Studio on 2026-10-06. Photo conversion can
get complicated, and it never needs Studio's tools for drawing and transforming paths.

## Settled

- **One server, a third page.** Photo is `photo.html` in `web/`, built into `static/` with Plot and
  Studio, and served by the same Flask process at `/photo` (port 5055). Its code is `web/src/photo/`.
  It reads presets and saves drawings through the same API, so it has no copy of any pen numbers.
- **The app switch has three buttons**, Photo, Studio, Plot, in the order a photo goes through them.
  It's in every header (`shared/components/AppSwitch.tsx`).
- **Boundaries.** `scripts/check-boundaries.mjs` stops Photo importing from Plot or Studio, and stops
  either of them importing from Photo. Anything two of the apps need goes in `web/src/shared/`.
- **Calibration moves to Photo.** That means the calibration and pen pairs sheets, reading a photo of
  them back, and the measured swatches. The measurements stay on the preset
  (`PUT /api/presets/<name>/calibration`), so nothing changes on the server.
- **Output.** Photo saves a layered SVG into the Drawings folder, the way Studio does, and has Send to
  Plot. Layers are named after their pen ("Black", "Black - Words") and stack lightest at the bottom.

## Built

- **The frame:** the header and the app switch; the rail, with a Photo card (open a photo) and the
  shared Settings, Paper and Drawing tool cards; the photo shown on the paper. Photo's tool and paper
  colour are its own choices in this browser (`photo-tool`, `photo-paper-color`).
- **The drawing model is shared** (2026-10-06): shapes, fills, paths, curves, repeats, text, the
  stroke fonts, the SVG writer and reader, and photo layers. All of it moved unchanged from
  `studio/lib/` to `shared/lib/drawing/`, with `useDrawingFile` (save and Send to Plot). Studio
  behaves as before, and both apps write the same files.
- **Calibration** (2026-10-06), in Photo's Setup behind the gear, moved from Studio's:
  - New calibration sheet and New pen pairs sheet, for the chosen tool on the chosen paper. The sheet
    is shown on the stage, drawn at the pen's width, with its name, Save and Send to Plot. The words
    are always in EMSOsmotron, the font every sheet so far has used.
  - Open a sheet, to read a photo of one saved before. It switches to the tool the sheet was saved for.
  - Read a photo of the sheet, into the tool's preset, as before.
  - Replacing a sheet with unsaved changes, by making or opening another, asks first, as Studio does.

  Studio's Setup now just says calibration is in Photo, with a button to go there. The code is in
  `photo/lib/` (`calibration.ts`, `penPairs.ts`, `calibrationRead.ts`) and
  `photo/components/CalibrationSection.tsx`.

- **Photo conversion** (2026-10-06), moved from Studio. It is the whole of Photo's main view:
  - The shared File card. Open a photo, or several separations, starts a new drawing named after it.
    Open a drawing opens one with a photo in it (anything else is Studio's to edit). Photo also has
    New, Save, Send to Plot and Edit in Studio, which saves and then opens the drawing in Studio.
  - On the stage, Studio's conversion view: picture and lines side by side, overlay and mask views,
    synced zoom, undo and redo. In the rail, the stroke and length count, Settings, and the photo's
    card with hatching, tone bands, tone lines, colour and CMYK, fit and fill.
  - Photo holds the whole drawing. Anything Studio added (crop marks, words) is kept and saved back.
    The drawing worked on last is picked up again (`photo-last-file`), and `/photo?open=<path>` opens
    a given one.

  Studio still draws, moves and sizes photo layers, since they are part of its drawings, but it no
  longer opens photos or tunes them. A photo picked in Studio shows a card with "Save and open in
  Photo". `FileSection`, `useHistory` and `usePhotoRead` are shared now; `photoActions`, `PhotoCard`
  and `ConvertStage` are Photo's.

## Photo to print

Agreed with Tom on 2026-10-06:
1. A predicted print and a closeness score.
2. Choosing the best N pens against their measured colours. N is Tom's choice, shown alongside the
   scores for N−1 and N+1.
3. Two pens hatched over each other. The overlap is predicted from single-pen measurements at
   first, and corrected later from the pen pairs sheet.

A tool that hasn't been measured uses its palette colours instead, with a note saying so.

**Step 1, built.** The Predicted print view (the printer button over the stage) shows the picture
beside what its lines should look like on the paper. The conversion summary gives the score: the
average ΔE between the print and the photo, each averaged over patches 4 mm across. The code is in
`photo/lib/predict.ts`.

- **The model.** Each layer's real lines are drawn at the pen's width. A layer passes its ink's share
  of the light (its line colour against the paper it was measured on), mixed by how much of each
  spot it covers. Layers multiply over the paper's colour, like filters. An opaque ink covers what's
  under it instead.
- **Checked against the EnerGel calibration sheet.** Line colour over its covered share, mixed in
  linear light, predicts the measured 50, 25 and 12.5% patches to a mean of 1.8 ΔE (worst 8.3).
  The best-fit shares were 0.52, 0.24 and 0.13 against the nominal 0.5, 0.25 and 0.125. Mixing in
  sRGB values was 7.9 ΔE.
- **The line colour.** It is the measured `line` where the calibration has one. Otherwise it is the
  palette colour, which for EnerGel is the measured line core.
- **Not yet modelled.** A building ink (a brush) darkening where its own lines cross.

**Step 2, built.** Colour mode has a choice: **Best fit** (the default for a new colour split) or
**By groups** (the old way: group the photo's colours, then give each group its nearest pen).

- **Choosing pens** (`photo/lib/choosePens.ts`). Each pen is taken as it comes out solid on this
  paper: its measured line colour moved from the paper it was measured on to this one, or its palette
  colour if it hasn't been measured. For a sample of 3000 pixels and each pen, it works out the share
  of paper the pen should cover to come nearest, mixed in linear light (`fitCover` in the shared
  `photo.ts`). Pens are added one at a time, each the one that helps most, then swapped while any
  swap helps.
- **Drawing them.** Each point goes to the pen that comes nearest there, or to bare paper if nothing
  beats it. That pen hatches it with as many passes as come nearest the share it wants
  (`coverSteps`, `passesFor`). This needs the pen's width, so `penMm` and `fitPaper` are saved with
  the photo and Studio redraws it the same way.
- **The Inks number** shows the estimated ΔE with one fewer, the same and one more pen.

On the colour test picture with EnerGel, the predicted print went from 22.3 ΔE (5 pens, by groups)
to 17.3 ΔE (4 pens, best fit). The estimate for 4 pens was 16.2. The difference is the hatching's
fixed steps. At EnerGel's 0.35 mm spacing, a pen covers 0, 40, 64, 88 or 96% of the paper, so a pale
colour has nothing between bare paper and 40%.

**Step 3, built.** Best fit has an **Overlaid pairs** box, ticked by default. Each point of the photo
takes whichever colour the chosen pens can make comes nearest: bare paper, one pen at 1 to 4
passes, or two pens hatched across each other at 1 to 4 passes each (`fitMenu` in the shared
`photo.ts`). Pairs mix the same way the prediction does: as filters, or covering for an opaque ink,
laid lightest first. Each pen's layer then draws the passes its share needs.

- **Discrete steps.** The fit and the pen search now both use the hatching's real steps rather than
  any share of the paper, so the estimate agrees with the predicted print.
- **Angles.** Paired pens' lines must cross, not lie along each other, so each layer is hatched at
  its own angle, spread across a quarter turn from 45°.
- **Saved with the photo.** `fitPairs` and `fitOpaque` are saved, so Studio redraws the drawing the
  same way.

On the colour test picture with EnerGel and 4 pens:

| Split | Predicted print |
| --- | --- |
| By groups (5 pens) | 22.3 ΔE |
| Single pens, best fit | 16.6 ΔE |
| With pairs (Lime Green, Orange, Blue, Sepia) | 6.7 ΔE |

The estimate with pairs was 7.3 ΔE.

**Pale colours, built.** Best fit has a **Fine steps** box, ticked by default for a new best fit.

- **The problem.** The normal hatching comes in whole passes, each drawing every other line at the
  closest spacing. For EnerGel at 0.35 mm, nothing falls between bare paper and 40% of it inked.
- **What fine steps do.** Lines at the closest spacing come in one at a time, in a fixed order, in
  groups of eight: 1, 2, 4, 6 and 8 of them one way, then 2, 4 and 8 across (`fineHatch`, `coverSteps`
  with `fine`). For EnerGel that gives about 10, 20, 40, 60, 80, 84, 88 and 96% coverage. Each line
  is still drawn once. Mid-tones show slightly uneven line spacing.
- **Saved with the photo** as `fineSteps`.

On the colour test picture with pairs, the predicted print went from 6.7 to 5.5 ΔE, with less pen
travel (264 m against 299 m). On a pastel test picture:

| Split | Predicted print |
| --- | --- |
| By value (nothing drawn) | 12.9 ΔE |
| By groups | 12.4 ΔE |
| Best fit, whole passes | 7.1 ΔE |
| Best fit, fine steps | 2.9 ΔE |

Re-splitting with pairs and fine steps can hold the page for about a second, because the pen search
runs on the main thread.

## Next

- Read the pen pairs sheet back, to correct the predicted overlaps with measured ones.
- Settle how pale colours are reached. Wider spacing for colour layers, or
lighter first passes, would give steps between bare paper and 40%.
