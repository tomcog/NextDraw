// What is done to a photo in Photo (moved from Studio, 2026-10-06): putting one in, splitting it into layers by value, by colour or
// into CMYK plates, sizing it to the page, turning it, replacing its picture, and its settings. Each
// acts on the chosen photo - and on all its layers where it should - through the app's own state,
// which it is handed, so App.tsx keeps the state and this keeps what is done with it.

import type { Dispatch, SetStateAction } from "react";
import { api, postJSON } from "../../shared/lib/api";
import { EDGE_STYLES, edgeKeep, type EdgeGen } from "../../shared/lib/drawing/edgeMask";
import { lightness } from "../../shared/lib/color";
import type { FitAlign } from "../../shared/lib/geometry";
import type { PenColor, Preset } from "../../shared/lib/types";
import {
  BAND_NAMES, LAYER_SETTINGS, MOST_SIDE_LAYERS, paperToneOf, MOST_COLORS, MOST_LAYERS, PHOTO_DEFAULTS, PLATES, PLATE_AIMS, PLATE_OFF, colourGroups, isColourful, matchPens, photoMode,
  placeOnPage, photoData, photoFromData, inkNamed, loadProfile, plateOfPhoto, platePens, presetAngle, readTones, hexLinear, linearHex, coverSteps, stemWithoutPlate, turnedCopy, turnedCrop, workingCopy, MASK_EDGE_PX, MASK_SIDES, type AnglePreset, type Photo, type PhotoPart, type Plate, type PlateSet, PLATE_SETS, plateSetOf, platesOf,
} from "../../shared/lib/drawing/photo";
import { boxOf, newLayerId, newShapeId, type Layer, type Page, type Shape } from "../../shared/lib/drawing/shapes";
import { samplePhoto, type Candidate } from "./choosePens";
import { searchPensOffPage } from "./penSearch";
import { folderOf, pictureChannels, pictureSources, type Inks } from "./separationFolder";
import { load, save as remember } from "../../shared/lib/storage";
import type { InkProfile } from "../../shared/lib/drawing/icc";

/** The profile a photo was last split by, and its intent: what the next is split by to start with. */
export const PROFILE_KEY = "photo-profile";
/** A profile's file name, from a drawing that kept its whole path before profiles had a folder of their own. */
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export interface PhotoContext {
  /** The one shape picked, if one is. */
  chosen: Shape | null;
  shapes: Shape[];
  setShapes: Dispatch<SetStateAction<Shape[]>>;
  layers: Layer[];
  setLayers: Dispatch<SetStateAction<Layer[]>>;
  /** The layer being drawn on, which a photo put in goes on or just above. */
  active: Layer | undefined;
  setActiveLayer: (id: string) => void;
  page: Page;
  /** The drawing tool, whose palette a photo's layers are matched to. */
  tool: Preset | null;
  /** The fill spacing the tool solid-fills at, which a photo's closest lines start from. */
  spacingMm: number;
  /** The layers targeted in the Layers card, by id: where a change of a layer's settings goes. */
  targets: Set<string>;
  /** The paper being printed on: pens are chosen for how they come out on it. */
  paper: string;
  /** Take an undo snapshot before a change. */
  record: () => void;
  addShape: (shape: Shape) => void;
  pick: (id: string | null) => void;
  setMessage: (message: { text: string; ok: boolean; progress?: boolean }) => void;
  /** Hold the controls while something is worked out that a change would go stale under. */
  setBusy: (busy: boolean) => void;
}

// The last color picked for a layer, and when: a drag through the picker is one step to undo.
const colorStep = { layer: "", at: 0 };

/** An angle turned by so many degrees, kept to a half turn - a line at 190° is the line at 10° - to a tenth. */
const turnedBy = (angle: number, by: number) => Math.round(((((angle + by) % 180) + 180) % 180) * 10) / 10;

/**
 * The tones a photo split around the paper leaves bare, unless set by hand: a third of them, centred
 * on the paper's own tone, so gray paper keeps the midtones and the pens draw either side of it. Kept
 * a sixth clear of white when there are light pens, and of black when there are dark ones: on white
 * or cream paper the third would otherwise start at white, and the light pen have nothing to draw.
 */
export function autoPaperTone(paper: string, dark: number, light: number): [number, number] {
  const at = 1 - (lightness(paper) ?? 100) / 100;
  const least = light > 0 ? 1 / 6 : 0;
  const most = (dark > 0 ? 5 / 6 : 1) - 1 / 3;
  const lo = Math.max(least, Math.min(most, at - 1 / 6));
  return [Math.round(lo * 100) / 100, Math.round((lo + 1 / 3) * 100) / 100];
}

export { pictureSources } from "./separationFolder";

export function photoActions(ctx: PhotoContext) {
  const { chosen, shapes, setShapes, layers, setLayers, active, setActiveLayer, page, tool: tool2, targets, paper, record, addShape, pick, setMessage, setBusy } = ctx;
  /**
   * Whether a shape is part of the chosen image: the chosen layer, its pass's other layers, and the
   * other passes over the same picture. What moves, sizes, crops, turns and changes picture together.
   */
  const sameImage = (sh: Shape) => {
    const c = chosen?.photo;
    if (!chosen || !c || !sh.photo) return sh.id === chosen?.id;
    return sh.id === chosen.id || Boolean(c.group && sh.photo.group === c.group) || Boolean(c.link && sh.photo.link === c.link);
  };
  const defaults = { spacingMm: ctx.spacingMm };

  // A photo, from a file on this Mac: made into a working copy, fitted to the page inside a half-inch
  // margin at its own proportions, and put on the layer being drawn on - whose ink it is hatched in.
  const addPhoto = async (file: File | undefined) => {
    if (!file || !active) return;
    try {
      const copy = await workingCopy(file);
      await readTones(copy.src);
      const margin = 0.5;
      const { crop, ...box } = placeOnPage(copy.width / copy.height, page, "fit", margin);
      const stem = file.name.replace(/\.[^.]+$/, "");
      const photo: Photo = { ...copy, ...PHOTO_DEFAULTS, spacingMm: defaults.spacingMm, crop, fit: "fit", margin, source: pictureSources.get(file) };
      const pens = tool2?.palette ?? [];
      // Matched to the tool's pens as it comes in. A colour photo is split into CMYK, each plate in the
      // pen nearest it (Tom, 2026-10-13) - or with fewer than four colors to choose from, by its
      // colours, each group in the nearest pen. A black and white one is one layer, in the pen
      // nearest its darkest shade. With no palette, it goes on the layer being drawn on, in its ink.
      let parts: { pen: PenColor; photo: Partial<Photo> }[] = [];
      const penMm = tool2?.settings.pen_width ?? 0.5;
      const colourful = isColourful(copy.src);
      const cmyk = colourful && pens.length >= PLATES.length ? platePens(pens, PLATES, { penMm, spacingMm: photo.spacingMm, levels: photo.levels }) : [];
      if (cmyk.length && cmyk.every(Boolean)) {
        const plates = cmyk.map((pen) => pen!.color);
        parts = PLATES.map((plate, i) => ({ pen: cmyk[i]!, photo: { plate, plates, ink: plates[i], angle: PLATE_AIMS[plate].angle, penMm } as Partial<Photo> }))
          // Lightest at the bottom, as the layers are laid down.
          .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
      } else if (pens.length && colourful) {
        const groups = colourGroups(copy.src, 4, photo.brightness, photo.contrast);
        const matched = matchPens(groups, pens);
        parts = groups.flatMap((_, region) => (matched[region] ? [{ pen: matched[region]!, photo: { ink: matched[region]!.color, regions: groups, region } as Partial<Photo> }] : []))
          // Stacked by the pens' own lightness, lightest at the bottom, as the layers are laid down.
          .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
        // And the key on top, in the palette's darkest pen, to darken the shadows of every colour.
        const key = darkestPen(pens);
        if (parts.length && key) parts.push({ pen: key, photo: { key: true, ink: key.color, regions: groups } });
        const regionInks = groups.map((_, r) => matched[r]?.color ?? null);
        parts = parts.map((part) => ({ ...part, photo: { ...part.photo, regionInks, keyInk: key?.color } }));
      } else if (pens.length) {
        // B&W starts in the palette's darkest pen - black, as a rule - whatever the photo's own darks.
        const pen = darkestPen(pens);
        if (pen) parts = [{ pen, photo: {} }];
      }
      if (!parts.length) {
        addShape({ id: newShapeId(), layerId: active.id, kind: "photo", name: stem, ...box, photo });
        setMessage({ text: "", ok: true }); // added: it's there on the page and in Layers, nothing to say
        return;
      }
      // New layers for it, just above the one being drawn on - unless that one is empty, as a new
      // drawing's first layer is, in which case the first of them takes its place.
      record();
      const reuse = !shapes.some((sh) => sh.layerId === active.id);
      const group = parts.length > 1 ? newShapeId() : undefined;
      const newLayers: Layer[] = parts.map((part, i) => (i === 0 && reuse
        ? { ...active, name: layerNameOf(part), color: part.pen.color }
        : { id: newLayerId(), name: layerNameOf(part), color: part.pen.color }));
      const made: Shape[] = parts.map((part, i) => ({
        id: newShapeId(),
        layerId: newLayers[i].id,
        kind: "photo",
        name: parts.length > 1 ? `${stem} ${layerNameOf(part)}` : stem,
        ...box,
        photo: { ...photo, ...part.photo, group },
      }));
      setLayers((list) => {
        const at = list.findIndex((l) => l.id === active.id);
        const kept = reuse ? list.map((l) => (l.id === active.id ? newLayers[0] : l)) : list;
        const adding = reuse ? newLayers.slice(1) : newLayers;
        return [...kept.slice(0, at + 1), ...adding, ...kept.slice(at + 1)];
      });
      setShapes((list) => [...list, ...made]);
      setActiveLayer(newLayers[0].id);
      pick(made[0].id);
      setMessage({ text: "", ok: true }); // added: it's there on the page and in Layers, nothing to say
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /**
    * Separations made elsewhere - a photo already split into greyscale plates, one file each - put in
    * as one photo on the page with a layer per plate, each drawing its own picture: darker where more
    * of its pen goes. A file whose name says its ink (see inkNamed: "_C", "cyan", "PortraitMagenta",
    * "orange", or a pen's own name) gets that plate's screen angle and the palette's pen nearest it -
    * each plate's pen used once - or that pen; four files that don't say are taken as C, M, Y and K in
    * the order given; anything else is its own ink, in the darkest pen. A file the browser can't read
    * is left out and said so, rather than stopping the rest; so are `skipped`, the files a folder had
    * that named no ink. Sized by the first, and the rest over it, so they register. Layers stack by
    * their pens' lightness, lightest at the bottom.
    */
  const addSeparations = async (files: File[], skipped: string[] = [], found?: Inks) => {
    if (!active || !files.length) return;
    try {
      const read = await Promise.allSettled(files.map(async (file) => {
        const copy = await workingCopy(file);
        await readTones(copy.src);
        return { file, copy };
      }));
      const copies = read.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const unreadable = files.filter((_, i) => read[i].status === "rejected").map((f) => f.name);
      if (!copies.length) {
        setMessage({ text: `The browser couldn't read ${unreadable.join(", ")}. Save them as PNG or JPEG and try again.`, ok: false });
        return;
      }
      const pens = tool2?.palette ?? [];
      // The inks as read already - from the names, and from Claude for names this app doesn't know.
      const inks = copies.map(({ file }) => (found ? found.inks.get(file) : inkNamed(file.name, pens)));
      // Four files and none named: C, M, Y and K, in the order they came.
      const plates = inks.every((ink) => !ink) && copies.length === 4 ? [...PLATES] : inks.map((ink) => ink?.plate);
      // Each plate's pen, chosen together so no two plates share one.
      const used = [...new Set(plates.filter((p): p is Plate => Boolean(p)))];
      const matched = used.length ? platePens(pens, used) : [];
      const darkest = darkestPen(pens);
      const [first] = copies;
      const margin = 0.5;
      const { crop, ...box } = placeOnPage(first.copy.width / first.copy.height, page, "fit", margin);
      const stem = stemWithoutPlate(first.file.name, pens, folderOf(first.file));
      const group = copies.length > 1 ? newShapeId() : undefined;
      const parts = copies.map(({ file, copy }, i) => {
        const plate = plates[i];
        // A pen by its name, or a color by its name: "Peach" is drawn in peach, whatever pen there is,
        // until one is chosen for it in the Layers card.
        const named = inks[i]?.pen ?? inks[i]?.color;
        const pen = plate ? matched[used.indexOf(plate)] ?? darkest : named ?? darkest;
        const separation = plate ? PLATE_AIMS[plate].name : named?.name ?? file.name.replace(/\.[^.]+$/, "");
        return {
          pen,
          separation,
          layerName: pen?.name ?? separation,
          layerColor: pen?.color ?? active.color,
          photo: {
            ...copy, ...PHOTO_DEFAULTS, spacingMm: defaults.spacingMm, crop, fit: "fit" as const, margin, group, separation, source: pictureSources.get(file), sourceChannel: pictureChannels.get(file),
            angle: plate ? PLATE_AIMS[plate].angle : PHOTO_DEFAULTS.angle + 15 * i,
          } as Photo,
        };
      }).sort((a, b) => (lightness(b.layerColor) ?? 0) - (lightness(a.layerColor) ?? 0));
      record();
      const reuse = !shapes.some((sh) => sh.layerId === active.id);
      const newLayers: Layer[] = parts.map((part, i) => (i === 0 && reuse
        ? { ...active, name: part.layerName, color: part.layerColor }
        : { id: newLayerId(), name: part.layerName, color: part.layerColor }));
      const made: Shape[] = parts.map((part, i) => ({
        id: newShapeId(), layerId: newLayers[i].id, kind: "photo", name: `${stem} ${part.separation}`, ...box, photo: part.photo,
      }));
      setLayers((list) => {
        const at = list.findIndex((l) => l.id === active.id);
        const kept = reuse ? list.map((l) => (l.id === active.id ? newLayers[0] : l)) : list;
        const adding = reuse ? newLayers.slice(1) : newLayers;
        return [...kept.slice(0, at + 1), ...adding, ...kept.slice(at + 1)];
      });
      setShapes((list) => [...list, ...made]);
      setActiveLayer(newLayers[0].id);
      pick(made[0].id);
      // Pictures of other proportions are stretched over the first, which puts them out of register.
      const aspect = first.copy.width / first.copy.height;
      const odd = copies.filter(({ copy }) => Math.abs(copy.width / copy.height / aspect - 1) > 0.01).map(({ file }) => file.name);
      // Files whose ink no name said - drawn in the darkest pen - and why Claude didn't say either.
      const unknown = copies.filter((_, i) => !inks[i] && !plates[i]).map(({ file }) => file.name);
      const left = [
        ...(unreadable.length ? [`couldn't read ${unreadable.join(", ")}`] : []),
        ...(unknown.length ? [`couldn't tell the ink of ${unknown.join(", ")}${found?.why ? ` (${found.why})` : ""}, so ${unknown.length === 1 ? "it's" : "they're"} in ${darkest?.name ?? "the darkest pen"} until you pick a color`] : []),
        ...(skipped.length ? [`left out ${skipped.join(", ")}, which ${skipped.length === 1 ? "names" : "name"} no ink`] : []),
      ];
      setMessage(odd.length
        ? { text: `${odd.join(", ")} ${odd.length === 1 ? "isn't" : "aren't"} the same shape as ${first.file.name}, so ${odd.length === 1 ? "it's" : "they're"} stretched to it and won't line up`, ok: false }
        : unreadable.length
          ? { text: `Added ${copies.length} separations, but ${left.join("; ")}. Save ${unreadable.length === 1 ? "it" : "them"} as PNG or JPEG to add ${unreadable.length === 1 ? "it" : "them"}.`, ok: false }
          // An ink that couldn't be told is said at the top, where it's seen: its layer needs a color.
          : { text: `Added ${copies.length} separations: ${parts.map((p) => `${p.separation} in ${p.layerName}`).join(", ")}${left.length ? `. ${left.join("; ").replace(/^./, (c) => c.toUpperCase())}` : ""}`, ok: !unknown.length });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /**
    * Rebuild the chosen photo as these layers: one photo shape each, the first keeping the photo's own
    * shape and layer, the rest on new layers put just above it, in order. The layers the photo's other
    * shapes were on go with them, once nothing else is left on them.
    */
  const rebuildPhoto = (parts: { layerName: string; layerColor: string; shapeName: string; photo: Partial<Photo> }[], group: string | undefined, note: string, keepAngles = false) => {
    if (!chosen?.photo) return;
    // Each layer at its angle in the photo's preset, turned as the photo is - unless putting back
    // layers as they were, angles and all.
    if (!keepAngles) {
      const preset = chosen.photo.anglePreset ?? "classic";
      const turn = chosen.photo.angleTurn ?? 0;
      parts = parts.map((p, i) => ({ ...p, photo: { ...p.photo, angle: turnedBy(presetAngle(preset, i, plateOfPhoto(p.photo)), turn) } }));
    }
    const oldGroup = chosen.photo.group;
    const members = oldGroup ? shapes.filter((sh) => sh.photo?.group === oldGroup) : [chosen];
    const base = members.find((m) => !m.photo?.band || m.photo.band[0] <= 0) ?? chosen;
    const baseLayer = layers.find((l) => l.id === base.layerId);
    if (!baseLayer || !parts.length) return;
    record();
    const others = new Set(members.filter((m) => m.id !== base.id).map((m) => m.id));
    const emptied = new Set(members.filter((m) => others.has(m.id)).map((m) => m.layerId)
      .filter((id) => id !== baseLayer.id && !shapes.some((sh) => sh.layerId === id && !others.has(sh.id))));
    const added: Layer[] = parts.slice(1).map((p) => ({ id: newLayerId(), name: p.layerName, color: p.layerColor }));
    // Split by a profile before: what made each layer one of its inks goes, unless the parts say again.
    const from = base.photo!.profile
      ? { ...base.photo!, profile: undefined, profileName: undefined, profileIntent: undefined, profileInk: undefined, separation: undefined, channelBrightness: undefined, channelContrast: undefined, channelBlackPoint: undefined, blackPoint: undefined }
      : base.photo!;
    const made: Shape[] = parts.map((p, i) => ({
      ...base,
      id: i === 0 ? base.id : newShapeId(),
      layerId: i === 0 ? baseLayer.id : added[i - 1].id,
      name: p.shapeName,
      photo: { ...from, ...p.photo, group },
    }));
    setLayers((list) => {
      const kept = list
        .filter((l) => !emptied.has(l.id))
        .map((l) => (l.id === baseLayer.id ? { ...l, name: parts[0].layerName, color: parts[0].layerColor } : l));
      const at = kept.findIndex((l) => l.id === baseLayer.id);
      return [...kept.slice(0, at + 1), ...added, ...kept.slice(at + 1)];
    });
    setShapes((list) => [...list.filter((sh) => !others.has(sh.id) && sh.id !== base.id), ...made]);
    pick(base.id);
    setMessage({ text: note, ok: true });
  };

  /** The chosen photo's layers as they stand, bottom first: what a mode remembers of itself. */
  const photoParts = (): PhotoPart[] => {
    if (!chosen?.photo) return [];
    const members = chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : [chosen];
    const place = (sh: Shape) => layers.findIndex((l) => l.id === sh.layerId);
    return [...members].sort((a, b) => place(a) - place(b)).map((m) => {
      const layer = layers.find((l) => l.id === m.layerId);
      const own = Object.fromEntries(LAYER_SETTINGS.map((k) => [k, m.photo![k]]));
      return { layerName: layer?.name ?? "Black", layerColor: layer?.color ?? "#262626", shapeName: m.name ?? "Image", photo: own };
    });
  };

  /**
    * Split the chosen photo the other way - by value or by colour - keeping how it was split this way
    * for when it comes back, and putting back how it was split that way before, if it has been.
    */
  const switchPhotoMode = (to: "value" | "colour" | "cmyk" | "profile") => {
    if (!chosen?.photo) return;
    const from = photoMode(chosen.photo);
    if (from === to) return;
    // A profile split isn't kept to come back to: it's made again, as quickly, from the profile.
    const modes = from === "profile" || from === "separations" ? { ...(chosen.photo.modes ?? {}) } : { ...(chosen.photo.modes ?? {}), [from]: photoParts() };
    if (to === "profile") {
      // The profile split by last, while it's still in the folder; or the folder's first.
      const last = load<{ file?: string; path?: string; intent?: number }>(PROFILE_KEY);
      void (async () => {
        const { profiles, folder } = await api<{ profiles: { file: string }[]; folder: string }>("/api/color-profiles").catch(() => ({ profiles: [], folder: "" }));
        const was = baseName(last?.file ?? last?.path ?? "");
        const file = profiles.find((p) => p.file === was)?.file ?? profiles[0]?.file;
        if (!file) {
          setMessage({ text: `No color profiles to split by yet: put printer profiles (.icc) in ${folder || "the Color profiles folder"}, then choose Profile again`, ok: false });
          return;
        }
        await splitPhotoProfile(file, last?.intent ?? 0, { modes });
      })();
      return;
    }
    const back = modes[to as "value" | "colour" | "cmyk"];
    if (back?.length) {
      // How it was split is the mode's own; how the photo is drawn and adjusted is the whole photo's,
      // and stays as it is now. Brought back as it was saved, a split kept from before a change of
      // effect came back in the old effect - Outlines switched to B&W turned back into Hatching.
      const { style, brightness, contrast, saturation } = chosen.photo;
      rebuildPhoto(
        back.map((part) => ({ ...part, photo: { ...Object.fromEntries(LAYER_SETTINGS.map((k) => [k, undefined])), ...part.photo, modes, style, brightness, contrast, saturation } })),
        back.length > 1 ? chosen.photo.group ?? newShapeId() : undefined,
        `Back to how it was split by ${to}`,
        true,
      );
    } else if (to === "colour") {
      splitPhotoBestFit(3, { modes });
    } else if (to === "cmyk") {
      splitPhotoCmyk({ modes });
    } else {
      splitPhoto(1, { modes });
    }
  };

  /**
    * Split the chosen photo by a printer's color profile: a layer for each of its inks, each drawing
    * that ink's share of the photo as the profile works it out. An ink named for a plate (Cyan, Orange)
    * gets that plate's pen and angle, as a separation's file does; a pen's own name, that pen; any
    * other, the color the profile gives it. Layers stack lightest at the bottom. The profile is
    * remembered, for the next photo split this way.
    */
  const splitPhotoProfile = async (file: string, intent = 0, extra: Partial<Photo> = {}) => {
    if (!chosen?.photo) return;
    setMessage({ text: "Reading the profile…", ok: true, progress: true });
    let profile: InkProfile;
    const path = baseName(file);
    let name = path.replace(/\.ic[cm]$/i, "");
    try {
      profile = await loadProfile(path);
      const listed = (await api<{ profiles: { file: string; name: string }[] }>("/api/color-profiles")).profiles.find((p) => p.file === path);
      if (listed) name = listed.name;
    } catch (err) {
      setMessage({ text: `Couldn't use that profile: ${(err as Error).message}`, ok: false });
      return;
    }
    remember(PROFILE_KEY, { file: path, intent });
    const pens = tool2?.palette ?? [];
    const inkNames = profile.names ?? Array.from({ length: profile.inks }, (_, i) => `Channel ${i + 1}`);
    const found = inkNames.map((ink) => inkNamed(ink, pens));
    const plates = found.map((f) => f?.plate);
    const used = [...new Set(plates.filter((p): p is Plate => Boolean(p)))];
    const matched = used.length ? platePens(pens, used) : [];
    const darkest = darkestPen(pens);
    const { name: stem } = photoStem();
    const parts = inkNames.map((ink, i) => {
      const plate = plates[i];
      const pen = plate ? matched[used.indexOf(plate)] : found[i]?.pen;
      const color = pen?.color ?? profile.colors?.[i] ?? found[i]?.color?.color ?? darkest?.color ?? "#262626";
      return {
        layerName: pen?.name ?? ink,
        layerColor: color,
        shapeName: `${stem} ${ink}`,
        photo: {
          band: undefined, side: undefined, paperTone: undefined, key: undefined, keyInk: undefined, regions: undefined, region: undefined, regionInks: undefined,
          fitPaper: undefined, fitPairs: undefined, plate: undefined, plates: undefined, ink: undefined,
          profile: path, profileName: name, profileIntent: intent || undefined, profileInk: i, separation: ink,
          ...extra,
        } as Partial<Photo>,
      };
    }).sort((a, b) => (lightness(b.layerColor) ?? 0) - (lightness(a.layerColor) ?? 0));
    rebuildPhoto(parts, chosen.photo.group ?? newShapeId(), `Split by ${name}: ${parts.map((p) => p.layerName).join(", ")}`);
  };

  /**
    * Split the chosen photo into CMYK: four plates, each in the tool's pen nearest printing's cyan,
    * magenta, yellow or black, each hatched at its screen angle, drawn across the whole photo and
    * blended on paper. Layers stack by their pens' lightness, lightest at the bottom.
    */
  const splitPhotoCmyk = (extra: Partial<Photo> = {}, set?: PlateSet) => {
    if (!chosen?.photo) return;
    // The set asked for, or the one the photo is in now, or print's four.
    const use = PLATE_SETS.find((s) => s.key === (set ?? (chosen.photo!.plate ? plateSetOf(chosen.photo!.plates) : "cmyk")))!;
    const pens = tool2?.palette ?? [];
    if (pens.length < use.plates.length) {
      setMessage({ text: `${tool2?.name ?? "This pen"} needs ${use.plates.length} colors in its palette to split an image into ${use.label}`, ok: false });
      return;
    }
    // Judged by how this pen's lines hatch at this photo's spacing and passes.
    const matched = platePens(pens, use.plates, { penMm: tool2?.settings.pen_width ?? 0.5, spacingMm: chosen.photo.spacingMm, levels: chosen.photo.levels });
    if (matched.some((p) => !p)) return;
    const plates = matched.map((p) => p!.color);
    const { name } = photoStem();
    const parts = use.plates.map((plate, i) => ({ plate, pen: matched[i]! }))
      .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
    rebuildPhoto(
      parts.map(({ plate, pen }) => ({
        layerName: pen.name,
        layerColor: pen.color,
        shapeName: `${name} ${pen.name}`,
        photo: {
          band: undefined, side: undefined, paperTone: undefined, key: undefined, keyInk: undefined, regions: undefined, region: undefined, regionInks: undefined,
          // Best fit's own options don't carry over.
          fitPaper: undefined, fitPairs: undefined,
          plate, plates, ink: pen.color, angle: PLATE_AIMS[plate].angle,
          // The pen's line width: with the spacing, how much paper each pass covers, which the
          // separation works out its passes from.
          penMm: tool2?.settings.pen_width ?? 0.5,
          ...extra,
        },
      })),
      chosen.photo.group ?? newShapeId(),
      `Split into ${use.label}: ${use.plates.map((p, i) => `${PLATE_AIMS[p].name} in ${matched[i]!.name}`).join(", ")}`,
    );
  };

  /** The palette's darkest pen: what a photo's key layer starts in. */
  const darkestPen = (pens: PenColor[]) =>
    [...pens].sort((a, b) => (lightness(a.color) ?? 1) - (lightness(b.color) ?? 1))[0];
  /** A photo layer's name: its pen's, and " key" after it for the key. */
  const layerNameOf = (part: { pen: PenColor; photo: Partial<Photo> }) => (part.photo.key ? `${part.pen.name} key` : part.pen.name);

  /** Put the chosen photo's key layer on, in the palette's darkest pen, or take it off. */
  const setKeyLayer = (on: boolean) => {
    if (!chosen?.photo?.ink || !chosen.photo.regions) return;
    const members = chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : [chosen];
    const existing = members.find((m) => m.photo?.key);
    if (on === Boolean(existing)) return;
    record();
    if (!on && existing) {
      const emptied = !shapes.some((sh) => sh.layerId === existing.layerId && sh.id !== existing.id);
      setShapes((list) => list.filter((sh) => sh.id !== existing.id).map((sh) => (members.some((m) => m.id === sh.id) ? { ...sh, photo: { ...sh.photo!, keyInk: undefined } } : sh)));
      if (emptied) setLayers((list) => list.filter((l) => l.id !== existing.layerId));
      if (chosen.id === existing.id) pick(members.find((m) => m.id !== existing.id)?.id ?? null);
      setMessage({ text: "Key layer off", ok: true });
      return;
    }
    const pen = darkestPen(tool2?.palette ?? []);
    if (!pen) return;
    const group = chosen.photo.group ?? newShapeId();
    const top = members.reduce((hi, m) => Math.max(hi, layers.findIndex((l) => l.id === m.layerId)), -1);
    const layer: Layer = { id: newLayerId(), name: `${pen.name} key`, color: pen.color };
    const { name } = photoStem();
    const keyShape: Shape = { ...chosen, id: newShapeId(), layerId: layer.id, name: `${name} ${pen.name} key`, photo: { ...chosen.photo, group, key: true, region: undefined, ink: pen.color, keyInk: pen.color } };
    setLayers((list) => [...list.slice(0, top + 1), layer, ...list.slice(top + 1)]);
    setShapes((list) => [...list.map((sh) => (members.some((m) => m.id === sh.id) ? { ...sh, photo: { ...sh.photo!, group, keyInk: pen.color } } : sh)), keyShape]);
    setMessage({ text: `Key layer on, in ${pen.name}`, ok: true });
  };

  /**
    * The photo's own name, and the ink a split by value draws in, without what an earlier split added:
    * the band word after a name, or the pen's name after a colour split's. From a colour split, the
    * value split starts in the palette's darkest pen, black as a rule, as a new B&W photo does.
    */
  const photoStem = () => {
    const words = /\s+(lightest|lighter|light|mid|dark|darker|darkest)$/i;
    const members = chosen?.photo?.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : chosen ? [chosen] : [];
    const base = members[0];
    const layer = layers.find((l) => l.id === base?.layerId);
    let name = base?.name ?? "Image";
    // A layer named for its pen - a colour, a plate, a split around the paper - is the photo's name
    // and the pen's: take the pen off, as often as it was put on.
    if ((base?.photo?.ink || base?.photo?.side) && layer) {
      while (name.endsWith(` ${layer.name}`)) name = name.slice(0, -layer.name.length - 1);
    } else if (base?.photo?.separation && name.endsWith(` ${base.photo.separation}`)) {
      // A separation is named for its plate after the image's name: "Portrait Yellow".
      name = name.slice(0, -base.photo.separation.length - 1);
    } else name = name.replace(words, "");
    // From a colour or CMYK split, or one around the paper, the palette's darkest pen; from B&W, the
    // pen its layer has now.
    if (base?.photo?.ink || base?.photo?.side) {
      const pen = darkestPen(tool2?.palette ?? []);
      return { name, ink: pen?.name ?? "Black", color: pen?.color ?? "#262626" };
    }
    return { name, ink: (layer?.name ?? "Black").replace(words, ""), color: layer?.color ?? "#262626" };
  };

  /**
    * Split the chosen photo by value into tone bands, one layer each, or put it back to one. The
    * lightest band keeps the photo's own layer; each darker one gets a layer above it, in the same ink,
    * named after the ink and the band - so the layers still say which pen to load, lightest at the
    * bottom. Every band starts from the same settings, to be changed one by one.
    */
  const splitPhoto = (count: number, extra: Partial<Photo> = {}) => {
    if (!chosen?.photo) return;
    const n = Math.min(MOST_LAYERS, Math.max(1, Math.round(count)));
    const members = chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : [chosen];
    if (members.length === n && !chosen.photo.ink && !extra.modes) return;
    const { name, ink, color } = photoStem();
    const words = BAND_NAMES[n] ?? [];
    rebuildPhoto(
      Array.from({ length: n }, (_, i) => ({
        layerName: n > 1 ? `${ink} ${words[i]}` : ink,
        layerColor: color,
        shapeName: n > 1 ? `${name} ${words[i]}` : name,
        photo: { band: n > 1 ? [i / n, (i + 1) / n] as [number, number] : undefined, side: undefined, paperTone: undefined, ink: undefined, regions: undefined, region: undefined, key: undefined, keyInk: undefined, regionInks: undefined, plate: undefined, plates: undefined, fitPaper: undefined, fitPairs: undefined, ...extra },
      })),
      n > 1 ? chosen.photo.group ?? newShapeId() : undefined,
      n > 1 ? `Split into ${n} tone layers` : "One layer, by value",
    );
  };

  /**
   * Split the chosen photo around the paper (B&W, "Dark + light pens"): the paper is one of its tones,
   * left bare - on gray paper, the midtones - with `dark` layers drawing the tones darker than it and
   * `light` layers the tones lighter, each side cut into that many bands from the paper outwards. Each
   * band draws its own region, its tones, in its own pen: black outermost on the dark side and white
   * on the light, with grays mixed from them and the paper's color nearer the paper. The bare
   * tones start around the paper's own lightness, a third of the picture's range, until set.
   */
  const splitAroundPaper = ({ dark, light, paperTone, extra = {} }: { dark: number; light: number; paperTone?: [number, number]; extra?: Partial<Photo> }) => {
    if (!chosen?.photo) return;
    const pens = tool2?.palette ?? [];
    const tone: [number, number] = paperTone ?? autoPaperTone(paper, dark, light);
    // The outermost band on each side is black, or white: the palette's own where it has one that
    // near, or else plain black and white. The bands between are the paper mixed with it, evenly -
    // two dark bands are black and a gray halfway from the paper to black.
    const byLight = [...pens].sort((a, b) => (lightness(a.color) ?? 0) - (lightness(b.color) ?? 0));
    const black = byLight[0] && (lightness(byLight[0].color) ?? 100) < 25 ? byLight[0] : { name: "Black", color: "#1a1a1a" };
    const lightest = byLight[byLight.length - 1];
    const white = lightest && (lightness(lightest.color) ?? 0) > 90 ? lightest : { name: "White", color: "#ffffff" };
    const mix = (to: string, t: number) => {
      const [a, b] = [paper, to].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
      return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
    };
    const nd = Math.min(MOST_SIDE_LAYERS, Math.max(0, Math.round(dark)));
    const nl = Math.min(MOST_SIDE_LAYERS, Math.max(0, Math.round(light)));
    const { name } = photoStem();
    const parts: (PhotoPart & { L: number; side: "dark" | "light"; i: number })[] = [];
    const sideOf = (side: "dark" | "light", n: number) => {
      const end = side === "dark" ? black : white;
      // From the paper outwards: the grays, then black or white.
      const grays = side === "dark" ? ["Dark gray", "Darker gray"] : ["Light gray", "Lighter gray"];
      for (let i = 0; i < n; i++) {
        const outer = i === n - 1;
        const pen = outer ? end : { name: grays[i], color: mix(end.color, (i + 1) / n) };
        parts.push({
          L: lightness(pen.color) ?? 0, side, i,
          layerName: pen.name,
          layerColor: pen.color,
          shapeName: `${name} ${pen.name}`,
          photo: {
            side, paperTone: tone, paperToneSet: paperTone ? true : undefined, band: n > 1 ? [i / n, (i + 1) / n] : undefined,
            ink: undefined, regions: undefined, region: undefined, key: undefined, keyInk: undefined, regionInks: undefined, plate: undefined, plates: undefined, fitPaper: undefined, fitPairs: undefined, ...extra,
          },
        });
      }
    };
    sideOf("dark", nd);
    sideOf("light", nl);
    if (!parts.length) return;
    // Lightest at the bottom.
    parts.sort((a, b) => b.L - a.L);
    rebuildPhoto(
      parts.map(({ layerName, layerColor, shapeName, photo }) => ({ layerName, layerColor, shapeName, photo })),
      parts.length > 1 ? chosen.photo.group ?? newShapeId() : undefined,
      `Split around the paper: ${parts.map((p) => p.layerName).join(", ")}`,
    );
  };

  /** Which of the picture's tones a photo split around the paper leaves bare: every layer of it, without splitting again. */
  const setPaperTone = (tone: [number, number]) => {
    if (!chosen?.photo?.side) return;
    record();
    const [a, b] = paperToneOf({ paperTone: tone });
    const group = chosen.photo.group;
    setShapes((list) => list.map((sh) => ((group ? sh.photo?.group === group : sh.id === chosen.id) && sh.photo?.side ? { ...sh, photo: { ...sh.photo, paperTone: [a, b], paperToneSet: true } } : sh)));
  };

  /**
    * Split the chosen photo by colour: its colours gathered into this many groups of similar colours,
    * each group matched to the nearest pen of the tool's palette, one layer each - named and coloured
    * after its pen, lightest at the bottom. Each layer draws its group's area, in its pen; give the
    * layer another pen and it draws the same area in that one. A group so pale it's the paper gets no
    * layer, so a photo can come back with fewer than asked.
    */
  const splitPhotoByColor = (count: number, extra: Partial<Photo> = {}) => {
    if (!chosen?.photo) return;
    const pens = tool2?.palette ?? [];
    if (!pens.length) {
      setMessage({ text: `${tool2?.name ?? "This pen"} has no palette of colors to split an image into`, ok: false });
      return;
    }
    const n = Math.min(MOST_COLORS, Math.max(1, Math.round(count)));
    const groups = colourGroups(chosen.photo.src, n, chosen.photo.brightness, chosen.photo.contrast, chosen.photo.saturation);
    const matched = matchPens(groups, pens);
    const parts = groups
      .map((hex, region) => ({ hex, region, pen: matched[region] }))
      .filter((g): g is { hex: string; region: number; pen: PenColor } => Boolean(g.pen))
      // Stacked by the pens' own lightness, lightest at the bottom: a group's pen can be a good deal
      // lighter or darker than the group's colour, and the layers go down in the pens.
      .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
    if (!parts.length) {
      setMessage({ text: "There's no color in this image to split, only paper", ok: false });
      return;
    }
    const { name } = photoStem();
    // The key on top, in the palette's darkest pen - or the pen the photo's key already has.
    const oldKey = chosen.photo.group ? shapes.find((sh) => sh.photo?.group === chosen.photo!.group && sh.photo?.key) : undefined;
    const keyPen = oldKey ? { name: layers.find((l) => l.id === oldKey.layerId)?.name.replace(/\s+key$/i, "") ?? "Key", color: oldKey.photo!.ink! } : darkestPen(pens);
    const regionInks = groups.map((_, r) => matched[r]?.color ?? null);
    const withKey = keyPen && (oldKey || photoMode(chosen.photo) !== "colour" || chosen.photo.keyInk !== undefined);
    rebuildPhoto(
      [
        ...parts.map(({ region, pen }) => ({
          layerName: pen.name,
          layerColor: pen.color,
          shapeName: `${name} ${pen.name}`,
          photo: { band: undefined, side: undefined, paperTone: undefined, key: undefined, plate: undefined, plates: undefined, fitPaper: undefined, penMm: undefined, fitPairs: undefined, ink: pen.color, regions: groups, region, regionInks, keyInk: withKey ? keyPen!.color : undefined, ...extra },
        })),
        ...(withKey ? [{
          layerName: `${keyPen!.name} key`,
          layerColor: keyPen!.color,
          shapeName: `${name} ${keyPen!.name} key`,
          photo: { band: undefined, side: undefined, paperTone: undefined, key: true, plate: undefined, plates: undefined, fitPaper: undefined, penMm: undefined, fitPairs: undefined, ink: keyPen!.color, regions: groups, region: undefined, regionInks, keyInk: keyPen!.color, ...extra },
        }] : []),
      ],
      parts.length + (withKey ? 1 : 0) > 1 ? chosen.photo.group ?? newShapeId() : undefined,
      `Split into ${parts.map((p) => p.pen.name).join(", ")}${withKey ? `, with ${keyPen!.name} as the key` : ""}${parts.length < n ? ` - the rest was paper, or near enough another` : ""}`,
    );
  };

  /**
   * The tool's pens as candidates for a photo on this paper: each pen's colour as it comes out solid -
   * its measured line where the tool has been calibrated, its palette colour where it hasn't - moved
   * from the paper it was measured on to this one, as a filter is.
   */
  const candidates = (): { pens: PenColor[]; list: Candidate[] } => {
    const pens = tool2?.palette ?? [];
    const measuredOn = hexLinear(tool2?.calibration?.paper ?? "#ffffff");
    const onto = hexLinear(paper);
    const list = pens.map((pen) => {
      const line = hexLinear(tool2?.calibration?.pens[pen.name]?.line ?? pen.color);
      return { name: pen.name, onPaper: linearHex(line.map((c, i) => onto[i] * Math.min(1, c / Math.max(1e-4, measuredOn[i])))) };
    });
    return { pens, list };
  };

  /** What a best fit for the chosen photo is made with: its hatching's steps, the tool's ink, and pairs or not. */
  const fitSettings = (pairs: boolean) => ({
    steps: coverSteps(tool2?.settings.pen_width ?? 0.5, chosen?.photo?.spacingMm ?? 0.5, chosen?.photo?.levels ?? 4),
    pairs,
    opaque: tool2?.settings.ink_opaque === true,
  });

  /**
   * The best `count` pens for the chosen photo on this paper, and how near the photo each count comes:
   * worked out off the page. Null while the photo hasn't been read.
   */
  const bestPens = async (count: number, pairs: boolean) => {
    if (!chosen?.photo) return null;
    const pixels = samplePhoto(chosen.photo.src, chosen.photo.brightness, chosen.photo.contrast, chosen.photo.saturation);
    if (!pixels) return null;
    const { pens, list } = candidates();
    const choice = await searchPensOffPage(pixels, list, paper, count, fitSettings(pairs));
    return choice ? { ...choice, pens: choice.pens.map((k) => ({ pen: pens[k], onPaper: list[k].onPaper })) } : null;
  };

  /**
   * Split the chosen photo by best fit: the `count` pens of the tool that, as they really come out on
   * this paper, come nearest the photo between them, a layer each. Each point is drawn by the pen that
   * comes nearest there, as much of it as matches - or, with `pairs`, by two pens hatched across each
   * other where together they come nearer. Layers stack by their pens' lightness, lightest at the
   * bottom. Paired pens' lines have to cross rather than lie along each other for their colours to mix
   * as worked out, so each layer is hatched at its own angle, spread across the quarter turn. The pens
   * are searched for off the page; the controls are held meanwhile, so the photo is still as it was
   * when the answer comes.
   */
  const splitPhotoBestFit = async (
    count: number,
    extra: Partial<Photo> = {},
    pairs = chosen?.photo?.fitPaper ? Boolean(chosen.photo.fitPairs) : true,
  ) => {
    if (!chosen?.photo) return;
    if (!tool2?.palette?.length) {
      setMessage({ text: `${tool2?.name ?? "This pen"} has no palette of colors to split an image into`, ok: false });
      return;
    }
    const n = Math.min(MOST_COLORS, Math.max(1, Math.round(count)));
    setBusy(true);
    setMessage({ text: "Choosing colors…", ok: true, progress: true });
    let best: Awaited<ReturnType<typeof bestPens>> = null;
    try {
      best = await bestPens(n, pairs);
    } catch (err) {
      setMessage({ text: `Couldn’t choose colors: ${(err as Error).message}`, ok: false });
      return;
    } finally {
      setBusy(false);
    }
    if (!best) {
      setMessage({ text: "The image is still being read: try again in a moment", ok: false });
      return;
    }
    const regions = best.pens.map((p) => p.onPaper);
    const regionInks = best.pens.map((p) => p.pen.color);
    const parts = best.pens
      .map((p, region) => ({ pen: p.pen, region }))
      .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
    const { name } = photoStem();
    rebuildPhoto(
      parts.map(({ pen, region }) => ({
        layerName: pen.name,
        layerColor: pen.color,
        shapeName: `${name} ${pen.name}`,
        photo: {
          band: undefined, side: undefined, paperTone: undefined, key: undefined, keyInk: undefined, plate: undefined, plates: undefined,
          ink: pen.color, regions, region, regionInks, fitPaper: paper, penMm: tool2.settings.pen_width ?? 0.5,
          fitPairs: pairs || undefined, fitOpaque: tool2.settings.ink_opaque === true || undefined,
          ...extra,
        },
      })),
      parts.length > 1 ? chosen.photo.group ?? newShapeId() : undefined,
      `Best ${parts.length === 1 ? "color" : `${parts.length} colors`} for this image on this paper${pairs ? ", in pairs where that comes nearer" : ""}: ${parts.map((p) => p.pen.name).join(", ")}`,
    );
  };

  /**
    * Size the chosen photo - all its bands - to the page: all of it as large as it fits, or filling the
    * page and cropped, inside a margin. Square to the page again, whatever it was turned to.
    */
  const placePhoto = (how: "fit" | "fill", margin: number, align?: FitAlign) => {
    if (!chosen?.photo) return;
    record();
    // Fitted against an edge stays against it - as Fit to paper chose, or as it was last fitted.
    const at = align ?? chosen.photo.align;
    const { crop, ...box } = placeOnPage(chosen.photo.width / chosen.photo.height, page, how, margin, at);
    setShapes((list) => list.map((sh) => (sameImage(sh)
      ? { ...sh, ...box, rotation: undefined, photo: { ...sh.photo!, crop, fit: how, margin, align: at } }
      : sh)));
  };


  /**
    * Put a different picture in the chosen photo - all its layers - keeping everything else: how it's
    * split, its layers and pens, and every layer's settings. Sized to the page, it's sized again for the
    * new picture; placed by hand, it keeps its place and width, its height following the new picture.
    * Split by colour, the new picture is sorted into the same colour groups, so the layers stay as
    * they are.
    */
  /**
   * Where a new picture of this proportion goes in place of the chosen one: sized to the page as it
   * was, or as wide as it was, about the same middle - uncropped either way.
   */
  const placedInstead = (sh: Shape, aspect: number) => {
    const was = sh.photo!;
    if (was.fit) {
      const placed = placeOnPage(aspect, page, was.fit, was.margin ?? 0.5, was.align);
      return { box: { x: placed.x, y: placed.y, x2: placed.x2, y2: placed.y2 }, crop: placed.crop };
    }
    const b = boxOf(sh);
    const w = b.x1 - b.x0;
    const h = w / aspect;
    const cy = (b.y0 + b.y1) / 2;
    return { box: { x: b.x0, y: cy - h / 2, x2: b.x1, y2: cy + h / 2 }, crop: undefined as Photo["crop"] };
  };

  /**
   * Read the chosen photo's file again - one opened from NextDraw's file browser, which remembers it -
   * and put it in place of the working copy: an edit made to the picture since, in Photoshop say.
   * Turned as it was turned here. The same shape as before, everything stays, crop and place
   * included; another shape, it's placed as Replace places a picture. Every setting stays either way.
   */
  const reloadPhoto = async () => {
    const was = chosen?.photo;
    if (!was?.source) return;
    const name = was.source.slice(was.source.lastIndexOf("/") + 1);
    setBusy(true);
    try {
      // A split photo's layers share one picture. Separations each have their own - a file each, or a
      // channel each of one Photoshop file - and are all reloaded together, so they stay in register.
      // A profile's inks are all the one photo, split again as they're drawn.
      const plates = was.separation && !was.profile && was.group
        ? shapes.filter((sh) => sh.photo?.group === was.group && sh.photo?.source)
        : null;
      const turn = async (copy: { src: string; width: number; height: number }, turns: number) => {
        if (turns === 3) copy = await turnedCopy(copy.src, -1);
        else for (let i = 0; i < turns; i++) copy = await turnedCopy(copy.src, 1);
        await readTones(copy.src);
        return copy;
      };
      // Each file read once, however many layers it's for: a Photoshop file's channels together.
      const files = new Map<string, Promise<Blob | Blob[]>>();
      const read = (p: Photo) => {
        const key = p.source!;
        if (!files.has(key)) {
          files.set(key, (async () => {
            const res = await fetch(p.sourceChannel !== undefined
              ? `/api/image-channels?path=${encodeURIComponent(key)}`
              : `/api/image-file?path=${encodeURIComponent(key)}`);
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${name} couldn't be read`);
            if (p.sourceChannel === undefined) return res.blob();
            const { channels } = await res.json() as { channels: { png: string }[] | null };
            if (!channels) throw new Error("it isn't a Multichannel file any more");
            return channels.map((ch) => new Blob([Uint8Array.from(atob(ch.png), (c) => c.charCodeAt(0))], { type: "image/png" }));
          })());
        }
        return files.get(key)!;
      };
      const fresh = async (p: Photo) => {
        const got = await read(p);
        const blob = Array.isArray(got) ? got[p.sourceChannel!] : got;
        if (!blob) throw new Error(`it has no channel ${p.sourceChannel! + 1} any more`);
        return turn(await workingCopy(new File([blob], name, { type: blob.type })), p.quarterTurns ?? 0);
      };
      const copies = new Map<string, { src: string; width: number; height: number }>();
      for (const sh of plates ?? [chosen!]) copies.set(sh.id, await fresh(sh.photo!));
      const copy = copies.get(chosen!.id) ?? [...copies.values()][0];
      const same = Math.abs(copy.width / copy.height / (was.width / was.height) - 1) < 0.01;
      const { box, crop } = same ? { box: undefined, crop: was.crop } : placedInstead(chosen!, copy.width / copy.height);
      record();
      setShapes((list) => list.map((sh) => {
        const mine = plates ? copies.get(sh.id) : sameImage(sh) ? copy : undefined;
        return mine ? { ...sh, ...(box ?? {}), photo: { ...sh.photo!, src: mine.src, width: mine.width, height: mine.height, crop } } : sh;
      }));
      setMessage(same
        ? { text: `Reloaded ${name}`, ok: true }
        : { text: `Reloaded ${name}: it's a different shape now, so it was placed again`, ok: true });
    } catch (err) {
      setMessage({ text: `Couldn't reload ${name}: ${(err as Error).message}`, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const replacePhoto = async (file: File | undefined) => {
    if (!file || !chosen?.photo) return;
    setBusy(true);
    try {
      const copy = await workingCopy(file);
      await readTones(copy.src);
      const aspect = copy.width / copy.height;
      const was = chosen.photo;
      const { box, crop } = placedInstead(chosen, aspect);
      record();
      if (was.separation && !was.profile) {
        // A separation is one plate of the photo: only its own picture changes, in the same place, so it
        // stays in register with the rest.
        setShapes((list) => list.map((sh) => (sh.id === chosen.id ? { ...sh, photo: { ...sh.photo!, src: copy.src, width: copy.width, height: copy.height, source: pictureSources.get(file), quarterTurns: undefined } } : sh)));
        const aspect0 = was.width / was.height;
        setMessage(Math.abs(aspect / aspect0 - 1) > 0.01
          ? { text: `${file.name} isn't the same shape as the other plates, so it's stretched to them and won't line up`, ok: false }
          : { text: `Replaced the ${was.separation} plate with ${file.name}`, ok: true });
        return;
      }
      setShapes((list) => list.map((sh) => (sameImage(sh)
        ? { ...sh, ...box, photo: { ...sh.photo!, src: copy.src, width: copy.width, height: copy.height, crop, source: pictureSources.get(file), quarterTurns: undefined } }
        : sh)));
      setMessage({ text: `Replaced the image with ${file.name}, keeping its settings`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  /**
    * Turn the chosen photo - every layer of it - a quarter, so it stands the way the paper does. The
    * picture itself turns, and with it any crop. Sized to the page, it's sized again; placed by hand,
    * it turns about its middle.
    */
  const turnPhoto = async (quarter: 1 | -1) => {
    if (!chosen?.photo) return;
    const members = shapes.filter(sameImage);
    try {
      // Each picture once: a split's layers share one, a separation's each have their own.
      const turned = new Map<string, Pick<Photo, "src" | "width" | "height">>();
      for (const sh of members) {
        if (!turned.has(sh.photo!.src)) turned.set(sh.photo!.src, await turnedCopy(sh.photo!.src, quarter));
      }
      await Promise.all([...turned.values()].map((t) => readTones(t.src)));
      const was = chosen.photo;
      const aspect = was.height / was.width;
      let box: { x: number; y: number; x2: number; y2: number };
      let crop: Photo["crop"];
      if (was.fit) {
        const placed = placeOnPage(aspect, page, was.fit, was.margin ?? 0.5, was.align);
        crop = placed.crop;
        box = { x: placed.x, y: placed.y, x2: placed.x2, y2: placed.y2 };
      } else {
        const b = boxOf(chosen);
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        const w = b.y1 - b.y0;
        const h = b.x1 - b.x0;
        box = { x: cx - w / 2, y: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
        crop = turnedCrop(was.crop, quarter);
      }
      record();
      const ids = new Set(members.map((sh) => sh.id));
      setShapes((list) => list.map((sh) => (ids.has(sh.id) ? { ...sh, ...box, photo: { ...sh.photo!, ...turned.get(sh.photo!.src)!, crop, quarterTurns: (((sh.photo!.quarterTurns ?? 0) + quarter) % 4 + 4) % 4 || undefined } } : sh)));
    } catch (err) {
      setMessage({ text: `Couldn’t turn the image: ${(err as Error).message}`, ok: false });
    }
  };

  /**
   * Set every layer of the chosen photo at its angle in a preset, the whole set turned: by a preset
   * newly chosen, or turned by `by` degrees from where it is.
   */
  const setAngles = ({ preset, by = 0 }: { preset?: AnglePreset; by?: number }) => {
    if (!chosen?.photo) return;
    record();
    const use = preset ?? chosen.photo.anglePreset ?? "classic";
    // Uniform, chosen: every layer takes the angle of the one in hand, which is then their shared turn.
    const turn = preset === "uniform" ? turnedBy(chosen.photo.angle, by) : turnedBy(chosen.photo.angleTurn ?? 0, by);
    const members = chosen.photo.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : [chosen];
    const place = (sh: Shape) => layers.findIndex((l) => l.id === sh.layerId);
    const order = [...members].sort((a, b) => place(a) - place(b)).map((m) => m.id);
    setShapes((list) => list.map((sh) => {
      const at = order.indexOf(sh.id);
      if (at < 0) return sh;
      return { ...sh, photo: { ...sh.photo!, anglePreset: use, angleTurn: turn || undefined, angle: turnedBy(presetAngle(use, at, plateOfPhoto(sh.photo!)), turn) } };
    }));
  };

  /**
   * Draw one plate in another of the pen's colors: its layer is named and colored after it, and the
   * photo is separated again - every plate's amounts depend on every pen in the set.
   */
  const setPlatePen = (plate: Plate, penName: string) => {
    if (!chosen?.photo?.plates) return;
    const at = platesOf(chosen.photo.plates).indexOf(plate);
    if (at < 0) return;
    // None: the channel is left out. The others are separated again without it, and its layer, kept
    // as it is, has nothing to draw until a pen is chosen for it again.
    if (penName === PLATE_OFF) {
      record();
      const plates = [...chosen.photo.plates];
      plates[at] = PLATE_OFF;
      const group = chosen.photo.group;
      setShapes((list) => list.map((sh) => ((group ? sh.photo?.group === group : sh.id === chosen.id) ? { ...sh, photo: { ...sh.photo!, plates } } : sh)));
      setMessage({ text: `${PLATE_AIMS[plate].name} left out: the other plates make up the image without it`, ok: true });
      return;
    }
    const pen = tool2?.palette?.find((p) => p.name === penName);
    if (!pen) return;
    record();
    const plates = [...chosen.photo.plates];
    plates[at] = pen.color;
    const group = chosen.photo.group;
    const members = group ? shapes.filter((sh) => sh.photo?.group === group) : [chosen];
    const onPlate = members.find((m) => m.photo?.plate === plate);
    const { name } = photoStem();
    setShapes((list) => list.map((sh) => {
      if (!members.some((m) => m.id === sh.id)) return sh;
      const own = sh.photo!.plate === plate;
      return { ...sh, ...(own ? { name: `${name} ${pen.name}` } : {}), photo: { ...sh.photo!, plates, ...(own ? { ink: pen.color } : {}) } };
    }));
    if (onPlate) setLayers((list) => list.map((l) => (l.id === onPlate.layerId ? { ...l, name: pen.name, color: pen.color } : l)));
    setMessage({ text: `${PLATE_AIMS[plate].name} in ${pen.name}`, ok: true });
  };

  /**
   * With no pen preset: draw the chosen photo's layer - or, given a plate, that plate's layer - in any
   * color at all, from the picker. Its layer keeps its name; its ink - a plate's color, a colour group's, the key's - becomes this one, so a
   * CMYK photo is separated again for it. A drag through the picker is one step to undo.
   */
  const setLayerColor = (color: string, plate?: Plate, layerId?: string, name?: string) => {
    // A CMYK plate's swatch colors that plate's layer, and the Layers card's any layer, whichever
    // layer is in hand. A palette pen picked there names the layer too.
    const ours = (sh: Shape) => sh.kind === "photo" && Boolean(sh.photo) && (chosen?.photo?.group ? sh.photo?.group === chosen.photo.group : sh.id === chosen?.id);
    const target = plate ? shapes.find((sh) => ours(sh) && sh.photo?.plate === plate) ?? chosen
      : layerId ? shapes.find((sh) => ours(sh) && sh.layerId === layerId)
      : chosen;
    if (!target?.photo) {
      // A layer with none of this image on it - one Studio added: its color and name alone.
      if (layerId) {
        record();
        setLayers((list) => list.map((l) => (l.id === layerId ? { ...l, color, ...(name ? { name } : {}) } : l)));
      }
      return;
    }
    const now = Date.now();
    if (colorStep.layer !== target.layerId || now - colorStep.at > 1500) record();
    colorStep.layer = target.layerId;
    colorStep.at = now;
    const p = target.photo;
    const was = (p.plate && p.plates ? p.plates[platesOf(p.plates).indexOf(p.plate)] : p.ink ?? p.keyInk)?.toLowerCase();
    const plates = p.plate && p.plates ? p.plates.map((c, i) => (i === platesOf(p.plates!).indexOf(p.plate!) ? color : c)) : undefined;
    const group = p.group;
    setShapes((list) => list.map((sh) => {
      const own = sh.id === target.id;
      if (!own && !(group && sh.photo?.group === group)) return sh;
      const q = sh.photo!;
      return {
        ...sh,
        photo: {
          ...q,
          ...(plates ? { plates } : {}),
          ...(own && q.ink ? { ink: color } : {}),
          // The key's ink is every layer's to know, and so is each colour group's - but a group and the
          // key in the same color are still two layers, so only the one in hand changes.
          ...(p.key && was && q.keyInk?.toLowerCase() === was ? { keyInk: color } : {}),
          ...(!p.key && was && q.regionInks ? { regionInks: q.regionInks.map((c, r) => (r === p.region && c?.toLowerCase() === was ? color : c)) } : {}),
        },
      };
    }));
    setLayers((list) => list.map((l) => (l.id === target.layerId ? { ...l, color, ...(name ? { name } : {}) } : l)));
  };

  /**
   * Edge masks come from a library shared between Macs: a picture added is kept there under its file
   * name, and any of them can be chosen for this drawing. The drawing keeps its own copy of the one
   * it uses, so a mask taken out of the library, or replaced, never changes a drawing already made.
   */
  /** Add a picture to the edge mask library - its black is paper - and lay it over the chosen photo. */
  const addEdgeMask = async (file: File, taken: string[]) => {
    if (!chosen?.photo) return;
    try {
      const copy = await workingCopy(file, MASK_EDGE_PX);
      await readTones(copy.src);
      const stem = file.name.replace(/\.[^.]+$/, "").replace(/[/\\:]/g, "-").trim().slice(0, 100) || "Edge mask";
      let name = stem;
      for (let n = 2; taken.includes(name); n++) name = `${stem} ${n}`;
      await postJSON(`/api/edge-masks/${encodeURIComponent(name)}`, { src: copy.src }, "PUT");
      setPhotoOf({ edgeMask: copy.src, edgeMaskName: name, edgeMaskInvert: undefined, edgeGen: undefined });
      setMessage({ text: `${name} added to the edge masks and laid over the image: where it's black is left as paper`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /** Lay a mask from the library over the chosen photo, or take the mask off, with no name. */
  const chooseEdgeMask = async (name: string | undefined) => {
    if (!chosen?.photo) return;
    if (!name) {
      setPhotoOf({ edgeMask: undefined, edgeMaskName: undefined, edgeMaskInvert: undefined, edgeMaskSides: undefined, edgeGen: undefined });
      setMessage({ text: "Edge mask taken off", ok: true });
      return;
    }
    try {
      const { src } = await api<{ src: string }>(`/api/edge-masks/${encodeURIComponent(name)}`);
      await readTones(src);
      setPhotoOf({ edgeMask: src, edgeMaskName: name, edgeGen: undefined });
      setMessage({ text: `${name} laid over the image`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /** Lay a made edge over the chosen photo: a preset's, a new seed of it, or its numbers changed. */
  const setEdgeGen = (gen: EdgeGen) => {
    setPhotoOf({ edgeGen: gen, edgeMask: undefined, edgeMaskName: undefined, edgeMaskInvert: undefined });
  };

  /**
   * Keep the chosen photo's made edge in the library, as a picture like any other mask: all four
   * sides, at the shape of the part of the image that shows.
   */
  const saveEdgeGen = async (taken: string[]) => {
    const photo = chosen?.photo;
    if (!photo?.edgeGen) return;
    const label = EDGE_STYLES.find((s) => s.key === photo.edgeGen!.style)?.label ?? "Edge";
    let suggest = label;
    for (let n = 2; taken.includes(suggest); n++) suggest = `${label} ${n}`;
    const name = window.prompt("Save this edge to the edge masks as:", suggest)?.replace(/[/\\:]/g, "-").trim();
    if (!name) return;
    if (taken.includes(name) && !window.confirm(`Replace the edge mask “${name}”?`)) return;
    try {
      const [c0, c1, c2, c3] = photo.crop ?? [0, 0, 1, 1];
      const aspect = (photo.width * (c2 - c0)) / Math.max(1e-6, photo.height * (c3 - c1));
      const w = Math.round(aspect >= 1 ? MASK_EDGE_PX : MASK_EDGE_PX * aspect);
      const h = Math.round(aspect >= 1 ? MASK_EDGE_PX / aspect : MASK_EDGE_PX);
      const keep = edgeKeep(photo.edgeGen, MASK_SIDES, w, h);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = Math.round(keep[i] * 255);
        img.data.set([v, v, v, 255], i * 4);
      }
      ctx.putImageData(img, 0, 0);
      await postJSON(`/api/edge-masks/${encodeURIComponent(name)}`, { src: canvas.toDataURL("image/jpeg", 0.85) }, "PUT");
      setMessage({ text: `This edge saved to the edge masks as ${name}`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /** Take a mask out of the library. Drawings that use it keep their own copy. */
  const deleteEdgeMask = async (name: string) => {
    try {
      await api(`/api/edge-masks/${encodeURIComponent(name)}`, { method: "DELETE" });
      setMessage({ text: `${name} taken out of the edge masks; drawings that use it keep it`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /**
   * Presets: everything about how the chosen image is drawn - its layers and passes, their effects,
   * numbers and pens, its edge - kept under a name, without the picture, to put on another picture
   * later. Separations can't have one: each plate draws a picture of its own.
   */
  const presetBlocked = () => Boolean(chosen?.photo?.separation && !chosen.photo.profile);
  const savePreset = async (taken: string[]) => {
    if (!chosen?.photo || presetBlocked()) return;
    const { name: stem } = photoStem();
    const name = window.prompt("Save how this image is drawn as the preset:", stem)?.replace(/[/\\:]/g, "-").trim();
    if (!name) return;
    if (taken.includes(name) && !window.confirm(`Replace the preset “${name}”?`)) return;
    const members = shapes.filter(sameImage);
    // Bottom first, as the layers stack. A shape named after the image keeps only what follows its
    // name, so it's named after the next picture instead.
    const presetLayers = layers.filter((l) => members.some((sh) => sh.layerId === l.id)).map((l) => ({
      name: l.name,
      color: l.color,
      shapes: members.filter((sh) => sh.layerId === l.id).map((sh) => {
        const { src: _src, width: _w, height: _h, source: _s, source_channel: _c, quarter_turns: _q, crop: _crop, fit: _fit, margin: _m, align: _a, ...settings } = photoData(sh.photo!) as Record<string, unknown>;
        return { ...(sh.name?.startsWith(stem) ? { after: sh.name.slice(stem.length) } : { name: sh.name }), photo: settings };
      }),
    }));
    try {
      await postJSON(`/api/image-presets/${encodeURIComponent(name)}`, { preset: { layers: presetLayers } }, "PUT");
      setMessage({ text: `Saved as the preset ${name}`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };
  /**
   * Draw the chosen image as a preset says: its layers and passes take the place of the image's own,
   * with every setting and pen the preset has. The picture stays, and so do its turn, crop and place.
   */
  const applyPreset = async (name: string) => {
    const was = chosen?.photo;
    if (!chosen || !was || presetBlocked()) return;
    try {
      type Saved = { layers: { name: string; color: string; shapes: { name?: string; after?: string; photo: Record<string, unknown> }[] }[] };
      const { preset } = await api<{ preset: Saved }>(`/api/image-presets/${encodeURIComponent(name)}`);
      const { name: stem } = photoStem();
      const members = shapes.filter(sameImage);
      const gone = new Set(members.map((sh) => sh.id));
      // Each preset group and pass gets ids of its own, so it's never joined to another image's.
      const fresh = new Map<string, string>();
      const renamed = (id: unknown) => {
        if (typeof id !== "string") return undefined;
        if (!fresh.has(id)) fresh.set(id, newShapeId());
        return fresh.get(id);
      };
      const newLayers: Layer[] = [];
      const newShapes: Shape[] = [];
      for (const pl of preset.layers ?? []) {
        const layer: Layer = { id: newLayerId(), name: pl.name, color: pl.color };
        newLayers.push(layer);
        for (const ps of pl.shapes ?? []) {
          const settings = photoFromData({ ...ps.photo, src: was.src, width: was.width, height: was.height });
          if (!settings) continue;
          const group = renamed(ps.photo.group);
          const link = renamed(ps.photo.link);
          newShapes.push({
            ...chosen,
            id: newShapeId(),
            layerId: layer.id,
            name: ps.after !== undefined ? `${stem}${ps.after}` : ps.name ?? stem,
            photo: {
              ...settings,
              group, link,
              source: was.source, sourceChannel: was.sourceChannel, quarterTurns: was.quarterTurns,
              crop: was.crop, fit: was.fit, margin: was.margin, align: was.align,
            },
          });
        }
      }
      if (!newShapes.length) throw new Error("it has no layers to draw");
      record();
      // The image's layers go where nothing else is on them, and the preset's take the place of the lowest.
      const emptied = new Set(layers.filter((l) => members.some((sh) => sh.layerId === l.id)
        && !shapes.some((sh) => sh.layerId === l.id && !gone.has(sh.id))).map((l) => l.id));
      const at = layers.findIndex((l) => members.some((sh) => sh.layerId === l.id));
      setLayers((list) => {
        const before = list.slice(0, Math.max(0, at)).filter((l) => !emptied.has(l.id));
        const after = list.slice(Math.max(0, at)).filter((l) => !emptied.has(l.id));
        return [...before, ...newLayers, ...after];
      });
      setShapes((list) => [...list.filter((sh) => !gone.has(sh.id)), ...newShapes]);
      const top = newShapes[newShapes.length - 1];
      pick(top.id);
      setActiveLayer(top.layerId);
      setMessage({ text: `Drawn as the preset ${name}`, ok: true });
    } catch (err) {
      setMessage({ text: `Couldn't use the preset ${name}: ${(err as Error).message}`, ok: false });
    }
  };
  const deletePreset = async (name: string) => {
    try {
      await api(`/api/image-presets/${encodeURIComponent(name)}`, { method: "DELETE" });
      setMessage({ text: `${name} taken out of the presets`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /**
   * Another pass over the chosen image: a layer of its own, on top, in the palette's darkest pen,
   * drawn as Edges - lines where the tone changes sharply - over whatever the image already draws.
   * It shares the picture and its place with the image's other passes and keeps its own settings;
   * its effect can be changed like any other's, and it can be split into layers of its own.
   */
  const addPass = () => {
    const was = chosen?.photo;
    if (!chosen || !was) return;
    record();
    const link = was.link ?? newShapeId();
    const pen = darkestPen(tool2?.palette ?? []) ?? { name: "Black", color: "#1a1a1a" };
    const layer: Layer = { id: newLayerId(), name: pen.name, color: pen.color };
    const { name } = photoStem();
    const pass: Shape = {
      ...chosen,
      id: newShapeId(),
      layerId: layer.id,
      name: `${name} edges`,
      photo: {
        // The picture and its place, from the image; everything else fresh.
        src: was.src, width: was.width, height: was.height, crop: was.crop, fit: was.fit, margin: was.margin, align: was.align,
        source: was.source, quarterTurns: was.quarterTurns,
        edgeMask: was.edgeMask, edgeMaskName: was.edgeMaskName, edgeMaskInvert: was.edgeMaskInvert, edgeMaskSides: was.edgeMaskSides, edgeGen: was.edgeGen,
        ...PHOTO_DEFAULTS, spacingMm: was.spacingMm,
        style: "edges", centerMode: "mixed", link,
      },
    };
    setLayers((list) => [...list, layer]); // on top: drawn last, over the shading
    setShapes((list) => [...list.map((sh) => (sameImage(sh) && !sh.photo?.link ? { ...sh, photo: { ...sh.photo!, link } } : sh)), pass]);
    pick(pass.id);
    setActiveLayer(layer.id);
    setMessage({ text: `A second pass over the image, drawn as Edges in ${pen.name}: choose its effect in the toolbar`, ok: true });
  };

  /** The chosen pass taken off the image - its layers too, where nothing else is on them. The image keeps its other passes. */
  const removePass = () => {
    const was = chosen?.photo;
    if (!chosen || !was?.link) return;
    const mine = (sh: Shape) => sh.id === chosen.id || Boolean(was.group && sh.photo?.group === was.group);
    const rest = shapes.filter((sh) => sh.photo?.link === was.link && !mine(sh));
    if (!rest.length) return; // the last pass is the image itself
    record();
    const gone = new Set(shapes.filter(mine).map((sh) => sh.id));
    const emptied = new Set(shapes.filter((sh) => gone.has(sh.id)).map((sh) => sh.layerId)
      .filter((id) => !shapes.some((sh) => sh.layerId === id && !gone.has(sh.id))));
    setShapes((list) => list.filter((sh) => !gone.has(sh.id)));
    setLayers((list) => list.filter((l) => !emptied.has(l.id)));
    pick(rest[0].id);
    setMessage({ text: "Pass taken off the image", ok: true });
  };

  /** Change how the chosen photo is turned into lines. */
  const setPhotoOf = (patch: Partial<Photo>) => {
    if (!chosen?.photo) return;
    record();
    // Brightness and contrast are the photo's, not a band's: they decide where the bands are cut, and
    // bands cut from different photos would overlap or leave gaps. The rest is each band's own. A
    // separation's plates have their own besides, set one at a time (setChannelOf).
    const group = chosen.photo.group;
    const whole: Partial<Photo> = {};
    if (patch.brightness !== undefined) whole.brightness = patch.brightness;
    if (patch.contrast !== undefined) whole.contrast = patch.contrast;
    if ("blackPoint" in patch) whole.blackPoint = patch.blackPoint;
    if ("saturation" in patch) whole.saturation = patch.saturation;
    if (patch.bleed !== undefined) whole.bleed = patch.bleed;
    if (patch.keyStrength !== undefined) whole.keyStrength = patch.keyStrength;
    if (patch.keyFrom !== undefined) whole.keyFrom = patch.keyFrom;
    if (patch.blackShare !== undefined) whole.blackShare = patch.blackShare;
    // The effect is the whole photo's: chosen in the toolbar, every layer drawn the same way.
    if ("style" in patch) whole.style = patch.style;
    // The edge mask frames the whole picture, so every layer - and every plate - is masked alike.
    if ("edgeMask" in patch) whole.edgeMask = patch.edgeMask;
    if ("edgeMaskName" in patch) whole.edgeMaskName = patch.edgeMaskName;
    if ("edgeMaskInvert" in patch) whole.edgeMaskInvert = patch.edgeMaskInvert;
    if ("edgeMaskSides" in patch) whole.edgeMaskSides = patch.edgeMaskSides;
    if ("edgeGen" in patch) whole.edgeGen = patch.edgeGen;
    // What frames the picture itself - the edge mask - goes to the image's other passes too.
    const image: Partial<Photo> = {};
    for (const k of ["edgeMask", "edgeMaskName", "edgeMaskInvert", "edgeMaskSides", "edgeGen"] as const) if (k in whole) (image as Record<string, unknown>)[k] = whole[k];
    const link = chosen.photo.link;
    // A layer's own settings go to the layers targeted in the Layers card - all of them, some, or
    // none - and the photo's to every layer.
    setShapes((list) => list.map((sh) => {
      if (sh.id !== chosen.id && !(group && sh.photo?.group === group)) {
        return link && sh.photo?.link === link && Object.keys(image).length ? { ...sh, photo: { ...sh.photo, ...image } } : sh;
      }
      const goes = targets.has(sh.layerId) ? patch : whole;
      return Object.keys(goes).length ? { ...sh, photo: { ...sh.photo!, ...goes } } : sh;
    }));
  };

  /** One separation plate's own brightness and contrast, by its shape: before the whole image's. 0 is none. */
  const setChannelOf = (id: string, patch: { channelBrightness?: number; channelContrast?: number; channelBlackPoint?: number }) => {
    record();
    setShapes((list) => list.map((sh) => {
      if (sh.id !== id || !sh.photo) return sh;
      const photo = { ...sh.photo, ...patch };
      if (!photo.channelBrightness) delete photo.channelBrightness;
      if (!photo.channelContrast) delete photo.channelContrast;
      if (!photo.channelBlackPoint) delete photo.channelBlackPoint;
      return { ...sh, photo };
    }));
  };

  return {
    setChannelOf, splitPhotoProfile,
    addPhoto, addSeparations, switchPhotoMode, setKeyLayer, splitPhoto, splitPhotoByColor, splitPhotoBestFit, bestPens,
    placePhoto, replacePhoto, reloadPhoto, savePreset, applyPreset, deletePreset, turnPhoto, setPhotoOf, addEdgeMask, chooseEdgeMask, deleteEdgeMask, setEdgeGen, saveEdgeGen, setAngles, photoStem, splitPhotoCmyk, setPlatePen, setLayerColor,
    splitAroundPaper, setPaperTone, addPass, removePass,
  };
}
