"""What Plot adds to a print when it plots it: the trim marks round the artboard, the colour blocks
and the signature - drawn into the COPY that goes to the plotter and to the preview, never into the
drawing (Tom, 2026-11-24).

That is the whole idea of this file. The same drawing can go on any sheet with the marks that suit
it, and the blocks can never go stale, because they are made from the layers as they stand at the
moment of plotting. It also says how far the page grew to hold them, which is the blue outline Plot
draws round what it is about to plot.

Above svgtree, below server.py: it knows the tree and the numbers, not the current drawing.
"""
from flask import request
from lxml import etree
from nextdraw import NextDraw
from pathlib import Path
from svgpaths import mm
from svgtree import DESIGN_TAG, INKSCAPE_NS, NON_DRAWING_TAGS, SVG_NS, design_margins, has_art, layer_groups, layer_hidden, page_mm_and_units
import json
import re

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# Studio's registration blocks (studio/lib/registration.ts): a small solid square per layer, named
# Registration in the design block. They go down before anything else in the plot, however the
# NextDraw software orders the rest for speed - it orders paths within a layer, starting from home,
# and would otherwise reach a block in the bottom corner last. So each plotted layer's blocks are
# moved, in the copy sent to the plotter, into a layer of their own - the same name and pen - ahead of
# every layer being plotted, in the layers' order. Then a short wait before the drawing itself starts,
# with the pen up: long enough to look at the blocks and press Stop if they show a pen skipping or the
# paper out of line, before any of the drawing is spent on it. The software checks for Stop every
# tenth of a second while it waits.
REGISTRATION_NAME = "Registration"

REGISTRATION_PAUSE_MS = 5_000

def registration_ids(root):
    """The ids of the shapes Studio's design block names Registration; empty for any other drawing."""
    for node in root.iter(DESIGN_TAG):
        try:
            data = json.loads(node.text or "{}")
        except ValueError:
            return set()
        names = data.get("names") if isinstance(data, dict) else None
        return {k for k, v in (names or {}).items() if v == REGISTRATION_NAME} if isinstance(names, dict) else set()
    return set()

def registration_first(root, made=()):
    """Move each plotted layer's registration blocks into a layer of their own ahead of all the plotted
    layers - the ones a drawing carries, and the ones Plot made for this print (`made`)."""
    from lxml import etree
    ids = registration_ids(root) | set(made)
    if not ids:
        return
    plotted = [g for g in layer_groups(root) if not layer_hidden(g)]
    if not plotted:
        return
    made = []
    for layer in plotted:
        # At any depth: a turned drawing keeps each layer's shapes in a <g transform="rotate(...)">.
        blocks = [el for el in layer.iter() if el is not layer and el.get("id") in ids]
        if not blocks:
            continue
        first = etree.Element(layer.tag, {k: v for k, v in layer.attrib.items() if k != "id"})
        first.set("id", f"{layer.get('id') or 'layer'}-registration")
        first.set(INKSCAPE_NS + "label", (layer.get(INKSCAPE_NS + "label") or "").lstrip("!"))
        for el in blocks:
            # The groups it sat in go with it, without their ids, so it keeps its turn and place.
            between = []
            for group in el.iterancestors():
                if group is layer:
                    break
                between.append(group)
            into = first
            for group in reversed(between):
                into = etree.SubElement(into, group.tag, {k: v for k, v in group.attrib.items() if k != "id"})
            el.getparent().remove(el)
            into.append(el)
        made.append(first)
    for first in made:
        plotted[0].addprevious(first)
    if made:
        with_delay(plotted[0], REGISTRATION_PAUSE_MS)

def with_delay(layer, ms):
    """Give a layer a wait at its start, in the NextDraw software's layer-name syntax: "+d" and the
    milliseconds, after a leading "!" (pause) and layer number if it has them, before the name."""
    label = layer.get(INKSCAPE_NS + "label") or ""
    m = re.match(r"^(!?)(\d*)(.*)$", label, re.S)
    layer.set(INKSCAPE_NS + "label", f"{m.group(1)}{m.group(2)}+d{ms}{m.group(3)}")

# ---- What Plot adds to a print when it plots it ----
#
# Three things are no part of the drawing and are made here, in the copy sent to the plotter and the
# preview: the trim marks round the artboard, the color blocks, and the signature. Plot keeps only
# WHERE they go, in its own block in the file, and sends that with each request the way it sends the
# scale and the turn. So none of them can go stale - the blocks are made from the layers and inks of
# the version being plotted, and the signature carries the year the print is made - and the drawing
# itself is never written into. A drawing that carries a set stamped into it from before (Studio used
# to) has them left out in favour of the generated ones, so nothing ever goes down twice.
#
# The blocks' and the signature's geometry comes WITH the request, as paths at their own size on paper
# (web/src/shared/lib/drawing/plotStamps.ts): the page holds the font and the drawing's layers, and
# both are always the same size on paper whatever size the artwork prints at - so they are made at
# that size and placed here, rather than drawn into the drawing's own coordinates. The trim marks are
# the page's own corners, so they are made here, and they scale with the page as the artboard does.
#
# All three can land outside the artboard, so the page the plotter is given grows to hold them and the
# drawing moves in by however much it grew before its top-left corner. Everything downstream works
# from that page, so the artwork lands where it was placed as long as there is room between it and
# home; where there isn't, the usual clamp at home loses part of what sits before it
# (lines_shifted_mm), which is the physical truth.
TRIM_LABEL = "Trim marks"

TRIM_LAYER_ID = "plot-trim-marks"

TRIM_LINE_MM = 0.25  # what the marks are drawn with in the preview; the pen's own width is the plot's

SIGNATURE_LABEL = "Signature"

SIGNATURE_LAYER_ID = "plot-signature"

BLOCK_ID = "plot-block-"

# A layer of either is labelled after its pen - "Black - Trim marks" - the apps' own naming (ink.ts).
TRIM_LABEL_END = re.compile(r"(?:^|\s-\s)%s$" % re.escape(TRIM_LABEL), re.I)

SIGNATURE_LABEL_END = re.compile(r"(?:^|\s-\s)%s$" % re.escape(SIGNATURE_LABEL), re.I)

# Path data as the page writes it: the commands it uses and the numbers between them, nothing else.
PATH_DATA = re.compile(r"[MLCQZAHVSTmlcqzahvst0-9eE+\-.,\s]{1,400000}")

def clean_ink(raw):
    """The pen something goes down in: which pen of which tool, or a color picked by hand."""
    if isinstance(raw, str) and HEX_COLOR.match(raw):
        return raw.lower()
    if isinstance(raw, dict):
        kept = {k: raw[k][:60] for k in ("tool", "pen") if isinstance(raw.get(k), str)}
        if isinstance(raw.get("hex"), str) and HEX_COLOR.match(raw["hex"]):
            kept["hex"] = raw["hex"].lower()
        return kept or None
    return None

def ink_parts(ink):
    """An ink's color for the preview, and the pen it names, for a layer Plot makes."""
    if isinstance(ink, str):
        return ink, None
    if isinstance(ink, dict):
        return ink.get("hex") or "#000000", ink.get("pen")
    return "#000000", None

def clean_trim(raw):
    """Plot's trim marks: each mark's length and how far it stands off the artboard's corner, in mm,
    and the ink they go down in. None for a drawing plotted without them."""
    if not isinstance(raw, dict):
        return None
    try:
        length = float(raw["length"])
        offset = float(raw["offset"])
    except (KeyError, TypeError, ValueError):
        return None
    if not length > 0:
        return None  # a mark with no length is no mark
    out = {"length": min(50.0, length), "offset": max(0.0, min(50.0, offset))}
    ink = clean_ink(raw.get("ink"))
    if ink:
        out["ink"] = ink
    return out

def clean_anchor(raw, axis):
    """Where one of Plot's additions sits on an axis: so far many mm inside or outside the named edge
    of the margins, the artboard or the artwork, as the Signature card reads it out."""
    edges = ("left", "right") if axis == "x" else ("top", "bottom")
    # The margins unless the page says otherwise, as in plotStamps.ts: they are the guides the print
    # was composed against, so what Plot adds belongs to them (Tom, 2026-11-25).
    out = {"mm": 0.0, "edge": edges[0], "side": "inside", "from": "margins"}
    if isinstance(raw, dict):
        try:
            out["mm"] = max(0.0, min(2000.0, float(raw.get("mm", 0))))
        except (TypeError, ValueError):
            pass
        for key, allowed in (("edge", edges), ("side", ("inside", "outside")), ("from", ("artwork", "artboard", "margins"))):
            if raw.get(key) in allowed:
                out[key] = raw[key]
    return out

def clean_size(raw):
    """A stamp's width or height, in inches on the paper."""
    try:
        return max(0.0, min(100.0, float(raw)))
    except (TypeError, ValueError):
        return 0.0

def clean_path(raw):
    """One path's data, as the page wrote it, or None for anything else."""
    text = raw.strip() if isinstance(raw, str) else ""
    return text if text and PATH_DATA.fullmatch(text) else None

def clean_signature(raw, geometry=False):
    """Plot's signature: where it goes and the pen, and with `geometry` the paths the page made for
    it too - at their own size on paper, the stamp's top-left at 0,0. None for a print without one."""
    if not isinstance(raw, dict):
        return None
    out = {"x": clean_anchor(raw.get("x"), "x"), "y": clean_anchor(raw.get("y"), "y")}
    ink = clean_ink(raw.get("ink"))
    if ink:
        out["ink"] = ink
    if geometry:
        d = [p for p in (clean_path(one) for one in (raw.get("d") or [])[:400]) if p]
        w, h = clean_size(raw.get("w")), clean_size(raw.get("h"))
        if not (d and w > 0 and h > 0):
            return None  # nothing to draw
        out.update(w=w, h=h, d=d)
    return out

def clean_blocks(raw, geometry=False):
    """Plot's color blocks: where the row goes, and with `geometry` the row itself - a block for each
    layer that goes down in this print, named by the layer it belongs to and in plotting order."""
    if not isinstance(raw, dict):
        return None
    out = {"x": clean_anchor(raw.get("x"), "x"), "y": clean_anchor(raw.get("y"), "y")}
    if geometry:
        items = []
        for one in (raw.get("items") or [])[:500]:
            d = clean_path(one.get("d")) if isinstance(one, dict) else None
            if d and isinstance(one.get("layer"), str):
                items.append({"layer": one["layer"][:200], "d": d})
        w, h = clean_size(raw.get("w")), clean_size(raw.get("h"))
        if not (items and w > 0 and h > 0):
            return None
        out.update(w=w, h=h, items=items)
    return out

def anchor_at(anchor, size, box, gap):
    """Where the near edge of something `size` across goes on this axis, in the page's own units:
    measured to the nearest edges of the two, so half an inch outside is half an inch of gap."""
    lo, hi = box
    if anchor["edge"] in ("left", "top"):
        return lo + gap if anchor["side"] == "inside" else lo - gap - size
    return hi - gap - size if anchor["side"] == "inside" else hi + gap

def trim_shape_ids(root):
    """The ids of the shapes a drawing carries as its own trim marks: Studio's design block names them
    as a parametric curve of kind "trim". Empty for any other drawing."""
    for node in root.iter(DESIGN_TAG):
        try:
            data = json.loads(node.text or "{}")
        except ValueError:
            return set()
        curves = data.get("curves") if isinstance(data, dict) else None
        return {c["shape"] for c in curves or []
                if isinstance(c, dict) and c.get("kind") == "trim" and isinstance(c.get("shape"), str)}
    return set()

def drop_stamped(root, ids=(), label=None):
    """Take out what a drawing carries of its own, so what Plot makes doesn't go down on top of it:
    the elements with these ids, any layer whose name ends in `label`, and any layer left with nothing
    to draw - which is no longer a layer at all (see layer_groups)."""
    ids = set(ids)
    if ids:
        for el in [el for el in root.iter() if el is not root and el.get("id") in ids]:
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
    for group in list(root):
        if not isinstance(group.tag, str) or group.tag != SVG_NS + "g":
            continue
        name = (group.get(INKSCAPE_NS + "label") or "").strip()
        if (label is not None and label.search(name)) or not has_art(group):
            root.remove(group)

def add_plot_extras(root, extras):
    """Everything Plot adds to the print, drawn into the copy it plots and previews: the color blocks
    on their own layers' groups, the signature on a layer of its own, and the trim marks round the
    artboard. Returns how far the page grew before the artboard's top-left corner, in mm on the paper
    (across, down) - which is how far before the artboard's place the plot starts. (0, 0) for a print
    with none of them, or a page whose size can't be read: none of this is worth refusing a plot over.
    """
    from lxml import etree
    extras = extras or {}
    trim, blocks, sig = extras.get("trim"), extras.get("blocks"), extras.get("signature")
    if not (trim or blocks or sig):
        return (0.0, 0.0)
    try:
        width_mm, units_wide = page_mm_and_units(root, "width", 2)
        height_mm, units_high = page_mm_and_units(root, "height", 3)
    except RuntimeError:
        return (0.0, 0.0)
    if not (width_mm > 0 and height_mm > 0 and units_wide > 0 and units_high > 0):
        return (0.0, 0.0)
    if not root.get("viewBox"):
        root.set("viewBox", f"0 0 {units_wide:g} {units_high:g}")
    vx, vy, vw, vh = [float(v) for v in re.split(r"[\s,]+", root.get("viewBox").strip())]
    per_in_x, per_in_y = units_wide / (width_mm / 25.4), units_high / (height_mm / 25.4)
    # The page is scaled after this, so anything that must come out the same size on paper whatever
    # the scale - the blocks, the signature, and the gaps they are placed by - is made smaller by as
    # much here. The marks are the artboard's own corners and scale with it, as they always have.
    factor = max(0.01, float(extras.get("scale") or 100.0)) / 100.0
    stamp_x, stamp_y = per_in_x / factor, per_in_y / factor
    board_x, board_y = (vx, vx + vw), (vy, vy + vh)
    art = extras.get("art")
    art_x = (vx + art[0] * per_in_x, vx + art[2] * per_in_x) if art else board_x
    art_y = (vy + art[1] * per_in_y, vy + art[3] * per_in_y) if art else board_y
    # The live area: the artboard less the margins the drawing was laid out inside. It is read from
    # the drawing itself rather than sent with the request, because it is the drawing's own (the
    # design block, written by Studio). Margins that leave no room fall back to the artboard.
    gap = design_margins(root)
    live_x = (board_x[0] + gap["left"] * per_in_x, board_x[1] - gap["right"] * per_in_x)
    live_y = (board_y[0] + gap["top"] * per_in_y, board_y[1] - gap["bottom"] * per_in_y)
    if not (live_x[1] > live_x[0] and live_y[1] > live_y[0]):
        live_x, live_y = board_x, board_y
    boxes = [(vx, vy, vx + vw, vy + vh)]  # the page itself, and then whatever lands outside it

    def place(setting):
        """Where a stamp's top-left goes, in the page's units; its box is kept for the page's growth."""
        w, h = setting["w"] * stamp_x, setting["h"] * stamp_y
        def against(axis, art, board, live):
            source = setting[axis]["from"]
            return art if source == "artwork" else live if source == "margins" else board
        x = anchor_at(setting["x"], w, against("x", art_x, board_x, live_x),
                      setting["x"]["mm"] / 25.4 * stamp_x)
        y = anchor_at(setting["y"], h, against("y", art_y, board_y, live_y),
                      setting["y"]["mm"] / 25.4 * stamp_y)
        boxes.append((x, y, x + w, y + h))
        return f"translate({x:g} {y:g}) scale({stamp_x:g} {stamp_y:g})"

    made_ids = []
    if blocks:
        # A block goes INSIDE its own layer, so it plots in that layer's pass and that layer's pen -
        # and registration_first then moves it to the front of the pass, as it does a stamped one.
        drop_stamped(root, registration_ids(root))
        at = place(blocks)
        by_id = {g.get("id"): g for g in layer_groups(root)}
        for item in blocks["items"]:
            layer = by_id.get(item["layer"])
            if layer is None:
                continue  # a layer that isn't in the drawing any more: no block, and no gap either
            group = etree.SubElement(layer, SVG_NS + "g")
            group.set("id", f"{BLOCK_ID}{item['layer']}")
            group.set("transform", at)
            group.set("fill", "none")
            etree.SubElement(group, SVG_NS + "path").set("d", item["d"])
            made_ids.append(group.get("id"))
    if sig:
        drop_stamped(root, label=SIGNATURE_LABEL_END)
        color, pen = ink_parts(sig.get("ink"))
        layer = etree.SubElement(root, SVG_NS + "g")
        layer.set(INKSCAPE_NS + "groupmode", "layer")
        layer.set(INKSCAPE_NS + "label", f"{pen} - {SIGNATURE_LABEL}" if pen else SIGNATURE_LABEL)
        layer.set("id", SIGNATURE_LAYER_ID)
        layer.set("fill", "none")
        layer.set("stroke", color)
        layer.set("stroke-width", f"{TRIM_LINE_MM * per_in_x / 25.4:g}")
        group = etree.SubElement(layer, SVG_NS + "g")
        group.set("transform", place(sig))
        for d in sig["d"]:
            etree.SubElement(group, SVG_NS + "path").set("d", d)
    if trim:
        drop_stamped(root, trim_shape_ids(root), TRIM_LABEL_END)
        per_mm_x, per_mm_y = per_in_x / 25.4, per_in_y / 25.4
        gap_x, len_x = trim["offset"] * per_mm_x, trim["length"] * per_mm_x
        gap_y, len_y = trim["offset"] * per_mm_y, trim["length"] * per_mm_y
        color, pen = ink_parts(trim.get("ink"))
        layer = etree.SubElement(root, SVG_NS + "g")
        layer.set(INKSCAPE_NS + "groupmode", "layer")
        layer.set(INKSCAPE_NS + "label", f"{pen} - {TRIM_LABEL}" if pen else TRIM_LABEL)
        layer.set("id", TRIM_LAYER_ID)
        layer.set("fill", "none")
        layer.set("stroke", color)
        layer.set("stroke-width", f"{TRIM_LINE_MM * per_mm_x:g}")
        x0, y0, x1, y1 = vx, vy, vx + vw, vy + vh
        # The corners in the order the pen goes round, each mark drawn from its outer end toward the
        # corner, the way a cut is lined up.
        for x, y, sx, sy in ((x0, y0, -1, -1), (x1, y0, 1, -1), (x1, y1, 1, 1), (x0, y1, -1, 1)):
            for run in ((x + sx * (gap_x + len_x), y, x + sx * gap_x, y),
                        (x, y + sy * (gap_y + len_y), x, y + sy * gap_y)):
                etree.SubElement(layer, SVG_NS + "path").set("d", "M {:g} {:g} L {:g} {:g}".format(*run))
        boxes.append((x0 - gap_x - len_x, y0 - gap_y - len_y, x1 + gap_x + len_x, y1 + gap_y + len_y))
    # The page grown to hold all of it, and the drawing moved in by whatever grew before its corner.
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    pad_x, pad_y = vx - x0, vy - y0
    if pad_x > 0 or pad_y > 0:
        shift = f"translate({pad_x:g} {pad_y:g})"
        for child in root:
            if not isinstance(child.tag, str) or child.tag in NON_DRAWING_TAGS:
                continue
            child.set("transform", f"{shift} {child.get('transform')}" if child.get("transform") else shift)
    root.set("viewBox", f"{vx:g} {vy:g} {x1 - x0:g} {y1 - y0:g}")
    for attr, was, now in (("width", vw, x1 - x0), ("height", vh, y1 - y0)):
        m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$", root.get(attr) or "", re.I)
        if m and was > 0:
            root.set(attr, f"{float(m.group(1)) * now / was:g}{m.group(2)}")
    extras["block_ids"] = made_ids
    return (pad_x / per_in_x * 25.4 * factor, pad_y / per_in_y * 25.4 * factor)
