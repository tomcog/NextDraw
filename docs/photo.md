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

## To move over from Studio, one piece at a time

Agree each move with Tom first. Studio's version keeps working until its replacement here does.

1. ~~Calibration~~: done.
2. Photo conversion: `photo.ts`, `photoActions.ts`, `usePhotoRead.ts`, `PhotoCard`, `ConvertStage`.
   These cover hatching, tone bands, tone lines and splitting by colour into palette pens.
3. ~~Saving and Send to Plot~~: the model and `useDrawingFile` are shared now; Photo's photo
   drawings use them once conversion is here.
4. Then the photo-to-print plan: choose the best pens against the measured colours, hatch two pens
   over each other, and show a predicted print beside the original.
