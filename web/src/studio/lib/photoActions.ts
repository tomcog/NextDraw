// What is done to a photo in Studio: putting one in, splitting it into layers by value, by colour or
// into CMYK plates, sizing it to the page, turning it, replacing its picture, and its settings. Each
// acts on the chosen photo - and on all its layers where it should - through the app's own state,
// which it is handed, so App.tsx keeps the state and this keeps what is done with it.

import type { Dispatch, SetStateAction } from "react";
import { lightness } from "../../shared/lib/color";
import type { PenColor, Preset } from "../../shared/lib/types";
import type { Tool } from "../components/Canvas";
import {
  BAND_NAMES, LAYER_SETTINGS, MOST_LAYERS, PHOTO_DEFAULTS, PLATES, PLATE_AIMS, colourGroups, darkestOf, isColourful, matchPens, photoMode,
  placeOnPage, plateNamed, platePens, readTones, stemWithoutPlate, turnedCopy, turnedCrop, workingCopy, type Photo, type PhotoPart, type Plate,
} from "./photo";
import { boxOf, newLayerId, newShapeId, type Layer, type Page, type Shape } from "./shapes";

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
  /** Whether a change of settings goes to all the photo's layers, not just the one picked. */
  all: boolean;
  /** Take an undo snapshot before a change. */
  record: () => void;
  addShape: (shape: Shape) => void;
  pick: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  setMessage: (message: { text: string; ok: boolean }) => void;
}

export function photoActions(ctx: PhotoContext) {
  const { chosen, shapes, setShapes, layers, setLayers, active, setActiveLayer, page, tool: tool2, all: photoAll, record, addShape, pick, setTool, setMessage } = ctx;
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
      const photo: Photo = { ...copy, ...PHOTO_DEFAULTS, spacingMm: defaults.spacingMm, crop, fit: "fit", margin };
      const pens = tool2?.palette ?? [];
      // Matched to the tool's pens as it comes in. A colour photo is split by its colours, each group in
      // the nearest pen; a black and white one is one layer, in the pen nearest its darkest shade. With
      // no palette, it goes on the layer being drawn on, in that layer's ink.
      let parts: { pen: PenColor; photo: Partial<Photo> }[] = [];
      if (pens.length && isColourful(copy.src)) {
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
        const pen = matchPens([darkestOf(copy.src)], pens)[0];
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
      setTool("select");
      setMessage({ text: "", ok: true }); // added: it's there on the page and in Layers, nothing to say
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /**
    * Separations made elsewhere - a photo already split into greyscale plates, one file each - put in
    * as one photo on the page with a layer per plate, each drawing its own picture: darker where more
    * of its pen goes. A file named for its plate ("_C", "cyan", "-K") gets the palette's pen nearest
    * that plate and its screen angle; four files that don't say are taken as C, M, Y and K in the
    * order given; anything else is its own ink, in the darkest pen. Sized by the first, and the rest
    * over it, so they register. Layers stack by their pens' lightness, lightest at the bottom.
    */
  const addSeparations = async (files: File[]) => {
    if (!active || !files.length) return;
    try {
      const copies = await Promise.all(files.map(async (file) => {
        const copy = await workingCopy(file);
        await readTones(copy.src);
        return { file, copy };
      }));
      const pens = tool2?.palette ?? [];
      const matched = pens.length >= 4 ? platePens(pens) : [];
      const named = copies.map(({ file }) => plateNamed(file.name));
      // Four files and none named: C, M, Y and K, in the order they came.
      const plates = named.every((p) => !p) && copies.length === 4 ? [...PLATES] : named;
      const darkest = darkestPen(pens);
      const [first] = copies;
      const margin = 0.5;
      const { crop, ...box } = placeOnPage(first.copy.width / first.copy.height, page, "fit", margin);
      const stem = stemWithoutPlate(first.file.name);
      const group = copies.length > 1 ? newShapeId() : undefined;
      const parts = copies.map(({ file, copy }, i) => {
        const plate = plates[i];
        const pen = plate ? matched[PLATES.indexOf(plate)] ?? darkest : darkest;
        const separation = plate ? PLATE_AIMS[plate].name : file.name.replace(/\.[^.]+$/, "");
        return {
          pen,
          separation,
          layerName: pen?.name ?? separation,
          layerColor: pen?.color ?? active.color,
          photo: {
            ...copy, ...PHOTO_DEFAULTS, spacingMm: defaults.spacingMm, crop, fit: "fit" as const, margin, group, separation,
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
      setTool("select");
      // Pictures of other proportions are stretched over the first, which puts them out of register.
      const aspect = first.copy.width / first.copy.height;
      const odd = copies.filter(({ copy }) => Math.abs(copy.width / copy.height / aspect - 1) > 0.01).map(({ file }) => file.name);
      setMessage(odd.length
        ? { text: `${odd.join(", ")} ${odd.length === 1 ? "isn't" : "aren't"} the same shape as ${first.file.name}, so ${odd.length === 1 ? "it's" : "they're"} stretched to it and won't line up`, ok: false }
        : { text: `Added ${copies.length} separations: ${parts.map((p) => `${p.separation} in ${p.layerName}`).join(", ")}`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /**
    * Which plate the chosen separation is: its name, its screen angle, and its layer's pen - the
    * palette's nearest to that plate, if the tool has four pens.
    */
  const setSeparationPlate = (plate: Plate | "other") => {
    if (!chosen?.photo?.separation) return;
    const pens = tool2?.palette ?? [];
    const pen = plate !== "other" && pens.length >= 4 ? platePens(pens)[PLATES.indexOf(plate)] : undefined;
    const was = chosen.photo.separation;
    const wasPlate = PLATES.some((p) => PLATE_AIMS[p].name === was);
    const separation = plate === "other" ? (wasPlate ? "Ink" : was) : PLATE_AIMS[plate].name;
    const name = chosen.name?.endsWith(` ${was}`) ? chosen.name.slice(0, -was.length - 1) : chosen.name ?? "Photo";
    record();
    setShapes((list) => list.map((sh) => (sh.id === chosen.id
      ? { ...sh, name: `${name} ${separation}`, photo: { ...sh.photo!, separation, ...(plate !== "other" ? { angle: PLATE_AIMS[plate].angle } : {}) } }
      : sh)));
    if (pen) setLayers((list) => list.map((l) => (l.id === chosen.layerId ? { ...l, name: pen.name, color: pen.color } : l)));
  };

  /**
    * Rebuild the chosen photo as these layers: one photo shape each, the first keeping the photo's own
    * shape and layer, the rest on new layers put just above it, in order. The layers the photo's other
    * shapes were on go with them, once nothing else is left on them.
    */
  const rebuildPhoto = (parts: { layerName: string; layerColor: string; shapeName: string; photo: Partial<Photo> }[], group: string | undefined, note: string) => {
    if (!chosen?.photo) return;
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
    const made: Shape[] = parts.map((p, i) => ({
      ...base,
      id: i === 0 ? base.id : newShapeId(),
      layerId: i === 0 ? baseLayer.id : added[i - 1].id,
      name: p.shapeName,
      photo: { ...base.photo!, ...p.photo, group },
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
      return { layerName: layer?.name ?? "Black", layerColor: layer?.color ?? "#262626", shapeName: m.name ?? "Photo", photo: own };
    });
  };

  /**
    * Split the chosen photo the other way - by value or by colour - keeping how it was split this way
    * for when it comes back, and putting back how it was split that way before, if it has been.
    */
  const switchPhotoMode = (to: "value" | "colour" | "cmyk") => {
    if (!chosen?.photo) return;
    const from = photoMode(chosen.photo);
    if (from === to) return;
    const modes = { ...(chosen.photo.modes ?? {}), [from]: photoParts() };
    const back = modes[to];
    if (back?.length) {
      rebuildPhoto(
        back.map((part) => ({ ...part, photo: { ...Object.fromEntries(LAYER_SETTINGS.map((k) => [k, undefined])), ...part.photo, modes } })),
        back.length > 1 ? chosen.photo.group ?? newShapeId() : undefined,
        `Back to how it was split by ${to}`,
      );
    } else if (to === "colour") {
      splitPhotoByColor(3, { modes });
    } else if (to === "cmyk") {
      splitPhotoCmyk({ modes });
    } else {
      splitPhoto(1, { modes });
    }
  };

  /**
    * Split the chosen photo into CMYK: four plates, each in the tool's pen nearest printing's cyan,
    * magenta, yellow or black, each hatched at its screen angle, drawn across the whole photo and
    * blended on paper. Layers stack by their pens' lightness, lightest at the bottom.
    */
  const splitPhotoCmyk = (extra: Partial<Photo> = {}) => {
    if (!chosen?.photo) return;
    const pens = tool2?.palette ?? [];
    if (pens.length < 4) {
      setMessage({ text: `${tool2?.name ?? "This tool"} needs four pens in its palette to split a photo into CMYK`, ok: false });
      return;
    }
    const matched = platePens(pens);
    if (matched.some((p) => !p)) return;
    const plates = matched.map((p) => p!.color);
    const { name } = photoStem();
    const parts = PLATES.map((plate, i) => ({ plate, pen: matched[i]! }))
      .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
    rebuildPhoto(
      parts.map(({ plate, pen }) => ({
        layerName: pen.name,
        layerColor: pen.color,
        shapeName: `${name} ${pen.name}`,
        photo: {
          band: undefined, key: undefined, keyInk: undefined, regions: undefined, region: undefined, regionInks: undefined,
          plate, plates, ink: pen.color, angle: PLATE_AIMS[plate].angle, ...extra,
        },
      })),
      chosen.photo.group ?? newShapeId(),
      `Split into CMYK: ${PLATES.map((p, i) => `${PLATE_AIMS[p].name} in ${matched[i]!.name}`).join(", ")}`,
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
    * value split takes its darkest ink.
    */
  const photoStem = () => {
    const words = /\s+(lightest|lighter|light|mid|dark|darker|darkest)$/i;
    const members = chosen?.photo?.group ? shapes.filter((sh) => sh.photo?.group === chosen.photo!.group) : chosen ? [chosen] : [];
    const base = members[0];
    const layer = layers.find((l) => l.id === base?.layerId);
    let name = base?.name ?? "Photo";
    if (base?.photo?.ink && layer && name.endsWith(` ${layer.name}`)) name = name.slice(0, -layer.name.length - 1);
    else name = name.replace(words, "");
    // From a colour split, the key's ink if it has one - the darkest - else its darkest colour's.
    const place = (sh: Shape) => layers.findIndex((l) => l.id === sh.layerId);
    const darkest = [...members].sort((a, b) => (a.photo?.key ? 1 : 0) - (b.photo?.key ? 1 : 0) || place(a) - place(b)).pop();
    const inkLayer = base?.photo?.ink ? layers.find((l) => l.id === darkest?.layerId) : layer;
    return { name, ink: (inkLayer?.name ?? "Black").replace(words, "").replace(/\s+key$/i, ""), color: inkLayer?.color ?? "#262626" };
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
        photo: { band: n > 1 ? [i / n, (i + 1) / n] as [number, number] : undefined, ink: undefined, regions: undefined, region: undefined, key: undefined, keyInk: undefined, regionInks: undefined, plate: undefined, plates: undefined, ...extra },
      })),
      n > 1 ? chosen.photo.group ?? newShapeId() : undefined,
      n > 1 ? `Split into ${n} tone layers` : "One layer, by value",
    );
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
      setMessage({ text: `${tool2?.name ?? "This tool"} has no palette of inks to split a photo into`, ok: false });
      return;
    }
    const n = Math.min(MOST_LAYERS, Math.max(1, Math.round(count)));
    const groups = colourGroups(chosen.photo.src, n, chosen.photo.brightness, chosen.photo.contrast);
    const matched = matchPens(groups, pens);
    const parts = groups
      .map((hex, region) => ({ hex, region, pen: matched[region] }))
      .filter((g): g is { hex: string; region: number; pen: PenColor } => Boolean(g.pen))
      // Stacked by the pens' own lightness, lightest at the bottom: a group's pen can be a good deal
      // lighter or darker than the group's colour, and the layers go down in the pens.
      .sort((a, b) => (lightness(b.pen.color) ?? 0) - (lightness(a.pen.color) ?? 0));
    if (!parts.length) {
      setMessage({ text: "There's no colour in this photo to split, only paper", ok: false });
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
          photo: { band: undefined, key: undefined, plate: undefined, plates: undefined, ink: pen.color, regions: groups, region, regionInks, keyInk: withKey ? keyPen!.color : undefined, ...extra },
        })),
        ...(withKey ? [{
          layerName: `${keyPen!.name} key`,
          layerColor: keyPen!.color,
          shapeName: `${name} ${keyPen!.name} key`,
          photo: { band: undefined, key: true, plate: undefined, plates: undefined, ink: keyPen!.color, regions: groups, region: undefined, regionInks, keyInk: keyPen!.color, ...extra },
        }] : []),
      ],
      parts.length + (withKey ? 1 : 0) > 1 ? chosen.photo.group ?? newShapeId() : undefined,
      `Split into ${parts.map((p) => p.pen.name).join(", ")}${withKey ? `, with ${keyPen!.name} as the key` : ""}${parts.length < n ? ` - the rest was paper, or near enough another` : ""}`,
    );
  };

  /**
    * Size the chosen photo - all its bands - to the page: all of it as large as it fits, or filling the
    * page and cropped, inside a margin. Square to the page again, whatever it was turned to.
    */
  const placePhoto = (how: "fit" | "fill", margin: number) => {
    if (!chosen?.photo) return;
    record();
    const group = chosen.photo.group;
    const { crop, ...box } = placeOnPage(chosen.photo.width / chosen.photo.height, page, how, margin);
    setShapes((list) => list.map((sh) => (sh.id === chosen.id || (group && sh.photo?.group === group)
      ? { ...sh, ...box, rotation: undefined, photo: { ...sh.photo!, crop, fit: how, margin } }
      : sh)));
  };
  /**
    * Scale the chosen photo - all its bands - about its middle, keeping its proportions. 100% is the
    * size Fit gives it inside the margin, so the number means the same whatever the page. Scaled by
    * number, it's no longer sized to the page.
    */
  const photoScale = (sh: Shape) => {
    const b = boxOf(sh);
    const aspect = (b.x1 - b.x0) / Math.max(1e-6, b.y1 - b.y0);
    const fit = placeOnPage(aspect, page, "fit", sh.photo?.margin ?? 0.5);
    return { b, aspect, fitW: fit.x2 - fit.x };
  };
  const setPhotoScale = (percent: number) => {
    if (!chosen?.photo || !(percent > 0)) return;
    const { b, aspect, fitW } = photoScale(chosen);
    const w = (fitW * percent) / 100;
    const h = w / aspect;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const box = { x: cx - w / 2, y: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
    record();
    const group = chosen.photo.group;
    setShapes((list) => list.map((sh) => (sh.id === chosen.id || (group && sh.photo?.group === group)
      ? { ...sh, ...box, photo: { ...sh.photo!, fit: undefined } }
      : sh)));
  };

  /** The margin a photo is sized inside: changing it sizes the photo again, if it's sized to the page. */
  const setPhotoMargin = (margin: number) => {
    if (!chosen?.photo) return;
    if (chosen.photo.fit) return placePhoto(chosen.photo.fit, margin);
    setPhotoOf({ margin });
  };

  /**
    * Put a different picture in the chosen photo - all its layers - keeping everything else: how it's
    * split, its layers and pens, and every layer's settings. Sized to the page, it's sized again for the
    * new picture; placed by hand, it keeps its place and width, its height following the new picture.
    * Split by colour, the new picture is sorted into the same colour groups, so the layers stay as
    * they are.
    */
  const replacePhoto = async (file: File | undefined) => {
    if (!file || !chosen?.photo) return;
    try {
      const copy = await workingCopy(file);
      await readTones(copy.src);
      const aspect = copy.width / copy.height;
      const was = chosen.photo;
      let box: { x: number; y: number; x2: number; y2: number };
      let crop: Photo["crop"];
      if (was.fit) {
        const placed = placeOnPage(aspect, page, was.fit, was.margin ?? 0.5);
        crop = placed.crop;
        box = { x: placed.x, y: placed.y, x2: placed.x2, y2: placed.y2 };
      } else {
        const b = boxOf(chosen);
        const w = b.x1 - b.x0;
        const h = w / aspect;
        const cy = (b.y0 + b.y1) / 2;
        box = { x: b.x0, y: cy - h / 2, x2: b.x1, y2: cy + h / 2 };
        crop = undefined;
      }
      record();
      if (was.separation) {
        // A separation is one plate of the photo: only its own picture changes, in the same place, so it
        // stays in register with the rest.
        setShapes((list) => list.map((sh) => (sh.id === chosen.id ? { ...sh, photo: { ...sh.photo!, src: copy.src, width: copy.width, height: copy.height } } : sh)));
        const aspect0 = was.width / was.height;
        setMessage(Math.abs(aspect / aspect0 - 1) > 0.01
          ? { text: `${file.name} isn't the same shape as the other plates, so it's stretched to them and won't line up`, ok: false }
          : { text: `Replaced the ${was.separation} plate with ${file.name}`, ok: true });
        return;
      }
      const group = was.group;
      setShapes((list) => list.map((sh) => (sh.id === chosen.id || (group && sh.photo?.group === group)
        ? { ...sh, ...box, photo: { ...sh.photo!, src: copy.src, width: copy.width, height: copy.height, crop } }
        : sh)));
      setMessage({ text: `Replaced the photo with ${file.name}, keeping its settings`, ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  /**
    * Turn the chosen photo - every layer of it - a quarter, so it stands the way the paper does. The
    * picture itself turns, and with it any crop. Sized to the page, it's sized again; placed by hand,
    * it turns about its middle.
    */
  const turnPhoto = async (quarter: 1 | -1) => {
    if (!chosen?.photo) return;
    const group = chosen.photo.group;
    const members = shapes.filter((sh) => sh.id === chosen.id || (group && sh.photo?.group === group));
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
        const placed = placeOnPage(aspect, page, was.fit, was.margin ?? 0.5);
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
      setShapes((list) => list.map((sh) => (ids.has(sh.id) ? { ...sh, ...box, photo: { ...sh.photo!, ...turned.get(sh.photo!.src)!, crop } } : sh)));
    } catch (err) {
      setMessage({ text: `Couldn’t turn the photo: ${(err as Error).message}`, ok: false });
    }
  };

  /** Change how the chosen photo is turned into lines. */
  const setPhotoOf = (patch: Partial<Photo>) => {
    if (!chosen?.photo) return;
    record();
    // Brightness and contrast are the photo's, not a band's: they decide where the bands are cut, and
    // bands cut from different photos would overlap or leave gaps. The rest is each band's own.
    const group = chosen.photo.group;
    const whole: Partial<Photo> = {};
    if (patch.brightness !== undefined) whole.brightness = patch.brightness;
    if (patch.contrast !== undefined) whole.contrast = patch.contrast;
    if (patch.bleed !== undefined) whole.bleed = patch.bleed;
    if (patch.keyStrength !== undefined) whole.keyStrength = patch.keyStrength;
    if (patch.keyFrom !== undefined) whole.keyFrom = patch.keyFrom;
    if (patch.blackShare !== undefined) whole.blackShare = patch.blackShare;
    // Set for all its layers: everything changed here goes to every one of them.
    const toAll = photoAll ? patch : whole;
    setShapes((list) => list.map((sh) => {
      if (sh.id === chosen.id) return { ...sh, photo: { ...sh.photo!, ...patch } };
      if (group && sh.photo?.group === group && Object.keys(toAll).length) return { ...sh, photo: { ...sh.photo, ...toAll } };
      return sh;
    }));
  };

  return {
    addPhoto, addSeparations, setSeparationPlate, switchPhotoMode, setKeyLayer, splitPhoto, splitPhotoByColor,
    placePhoto, photoScale, setPhotoScale, setPhotoMargin, replacePhoto, turnPhoto, setPhotoOf,
  };
}
