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

The frame only:
- the header and the app switch;
- the rail, with a Photo card (open a photo) and the shared Settings, Paper and Drawing tool cards;
- the photo shown on the paper;
- Setup behind the gear, with the theme switch.

Photo's tool and paper colour are its own choices in this browser (`photo-tool`, `photo-paper-color`).

## To move over from Studio, one piece at a time

Agree each move with Tom first. Studio's version keeps working until its replacement here does.

1. Calibration: `calibration.ts`, `penPairs.ts`, `calibrationRead.ts`, `CalibrationSection`.
2. Photo conversion: `photo.ts`, `photoActions.ts`, `usePhotoRead.ts`, `PhotoCard`, `ConvertStage`.
   These cover hatching, tone bands, tone lines and splitting by colour into palette pens.
3. Saving and Send to Plot. This needs the drawing model (`shapes.ts`, `svg.ts`, `hatch.ts`) moved into
   `shared/` so Photo and Studio write the same file.
4. Then the photo-to-print plan: choose the best pens against the measured colours, hatch two pens
   over each other, and show a predicted print beside the original.
