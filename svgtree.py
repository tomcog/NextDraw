"""The drawing's own SVG: reading it, its layers, its size, and the few conventions this app and
Studio agree on - Inkscape's layer labels, Illustrator's classes, Studio's fill ids (Tom, 2026-11-24).

The bottom of the pile: it knows the tree and nothing else - no plotter, no Flask, no current
drawing. server.py imports the names back, so server.parse_svg and the rest answer as they did.
"""
from lxml import etree
from nextdraw import NextDraw
from svgpaths import mm
import json
import re
import time

ILLUSTRATOR_POINTS_PER_INCH = 72.0

# Length units the SVG spec allows on width/height, in CSS px (user units when there's no viewBox).
PX_PER_UNIT = {"": 1.0, "px": 1.0, "in": 96.0, "mm": 96 / 25.4, "cm": 96 / 2.54, "pt": 96 / 72, "pc": 16.0}

ILLUSTRATOR_CLASS_RULE = re.compile(r"\.cls-\d+\s*\{")  # how Illustrator's Export As names its styles

def is_illustrator_svg(root):
    """
    Illustrator marks what it saves as SVG with a 'Generator: Adobe Illustrator' comment. Export As
    leaves the comment out, but still names layers and groups in data-name and styles as .cls-1, .cls-2
    - and still counts in points.
    """
    from lxml import etree
    for node in root.iter(etree.Comment):
        if "Adobe Illustrator" in (node.text or ""):
            return True
    parent = root.getprevious()
    while parent is not None:  # comments before <svg>
        if isinstance(parent, etree._Comment) and "Adobe Illustrator" in (parent.text or ""):
            return True
        parent = parent.getprevious()
    for el in root.iter(etree.Element):
        if el.get("data-name") is not None:
            return True
        if el.tag == SVG_NS + "style" and ILLUSTRATOR_CLASS_RULE.search(el.text or ""):
            return True
    return False

SVG_NS = "{http://www.w3.org/2000/svg}"

INKSCAPE_NS = "{http://www.inkscape.org/namespaces/inkscape}"

ILLUSTRATOR_ID_TAIL = re.compile(r"_\d{8,}_$")  # Illustrator's suffix when a name is used twice

ILLUSTRATOR_ID_ESCAPE = re.compile(r"_x([0-9A-Fa-f]{2,4})_")  # Illustrator's escape for characters ids can't hold

def layer_name(group, illustrator):
    label = group.get(INKSCAPE_NS + "label") or group.get("data-name")
    if label:
        return label
    name = group.get("id") or ""
    if name.startswith("nds-layer-"):
        return ""
    if illustrator:
        name = ILLUSTRATOR_ID_TAIL.sub("", name)
        name = ILLUSTRATOR_ID_ESCAPE.sub(lambda m: chr(int(m.group(1), 16)), name)
        name = name.replace("_", " ")
    return name.strip()

def class_paints(root, prop):
    """Colors set by class in <style> blocks, e.g. .st0{stroke:#912474} or .cls-1{fill:#1a5d80}."""
    paints = {}
    rule = re.compile(r"(?:^|;)\s*%s\s*:\s*([^;]+)" % prop)
    for style in root.iter(SVG_NS + "style"):
        for selectors, body in re.findall(r"([^{}]+)\{([^}]*)\}", style.text or ""):
            match = rule.search(body)
            if not match:
                continue
            for selector in selectors.split(","):
                selector = selector.strip()
                if selector.startswith("."):
                    paints[selector[1:]] = match.group(1).strip()
    return paints

def class_strokes(root):
    """Stroke colors set by class in <style> blocks, e.g. .st0{stroke:#912474}."""
    return class_paints(root, "stroke")

def paint_of(node, by_class, prop):
    match = re.search(r"(?:^|;)\s*%s\s*:\s*([^;]+)" % prop, node.get("style") or "")
    if match:
        return match.group(1).strip()
    if node.get(prop):
        return node.get(prop).strip()
    for cls in (node.get("class") or "").split():
        if cls in by_class:
            return by_class[cls]
    return None

def stroke_of(node, by_class):
    return paint_of(node, by_class, "stroke")

SHAPE_TAGS = {SVG_NS + t for t in ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon")}

def mark_color(node, stop, strokes, fills):
    """
    What color a mark is drawn in, looking up through its parents as far as `stop` - stroke first,
    since that's the line a pen draws, and otherwise the fill it's painted with. A flat illustration
    carries no strokes at all: every shape is a fill, and reading only strokes made such a file one
    black layer (Tom, 2026-11-24).
    """
    for prop, by_class in (("stroke", strokes), ("fill", fills)):
        walk = node
        while walk is not None:
            color = paint_of(walk, by_class, prop)
            if color and color.lower() != "none":
                return color.lower()
            if color:  # "none", said here: this mark has no color of that kind, inherited or not
                break
            walk = walk.getparent() if walk is not stop else None
    return None

def read_layers(root):
    """The drawing's layers, top to bottom as they appear in the file: Inkscape layers if the file has them,
    otherwise the top-level groups (which is how Illustrator writes its layers)."""
    illustrator = is_illustrator_svg(root)
    groups = layer_groups(root)
    by_class = class_strokes(root)
    by_class_fill = class_paints(root, "fill")
    fills = studio_fills(root)
    layers = []
    for index, group in enumerate(groups):
        counts = {}
        shapes = 0
        for node in group.iter():
            if node.tag not in SHAPE_TAGS:
                continue
            shapes += 1
            color = mark_color(node, group, by_class, by_class_fill)
            if color:
                counts[color] = counts.get(color, 0) + 1
        colors = sorted(counts, key=counts.get, reverse=True)
        name = layer_name(group, illustrator)
        layers.append({
            "index": index,
            "id": group.get("id"),
            "name": name or f"Layer {index + 1}",
            "color": colors[0] if colors else None,
            "colors": colors,
            "shapes": shapes,
            "skipped": name.startswith("%"),  # NextDraw doesn't plot layers whose names start with %
            "hidden": layer_hidden(group),  # hidden in Illustrator/Inkscape or in the app; not plotted
            "fill_spacing": fill_spacing_of(group, fills),  # mm: Studio's hatch spacing here, or None
        })
    return layers

def has_art(group):
    """Whether a group holds anything that can be drawn. Illustrator exports can carry empty groups."""
    return any(el.tag in SHAPE_TAGS or el.tag == SVG_NS + "use" for el in group.iter())

def layer_groups(root):
    """The elements read_layers reports, in file order: Inkscape layers if there are any, otherwise the
    top-level groups. Groups with nothing to draw in them aren't layers."""
    groups = [g for g in root if g.tag == SVG_NS + "g" and g.get(INKSCAPE_NS + "groupmode") == "layer"]
    groups = groups or [g for g in root if g.tag == SVG_NS + "g"]
    return [g for g in groups if has_art(g)]

AUTO_LAYER_ID = "nds-layer-"  # ids the app gives unnamed layers; never shown as a name

def parse_svg(path):
    from lxml import etree
    return etree.parse(str(path), etree.XMLParser(huge_tree=True, remove_blank_text=False))

def svg_bytes(tree):
    from lxml import etree
    return etree.tostring(tree, xml_declaration=True, encoding=tree.docinfo.encoding or "utf-8")

# Beyond this many colors a group isn't a pen separation, it's a full-color illustration, and a layer
# apiece would be hundreds of rows nobody can plot. Such a group is left as the one layer it is.
SPLIT_COLOR_LIMIT = 24

# Ids an exporter made up rather than a name anybody chose. A layer called "path1234" helps no one.
MADE_UP_ID = re.compile(r"^(?:path|shape|layer|group|g|svg|rect|circle|ellipse|line|poly\w*|cls)?[-_]?\d*$", re.I)

def split_layers_by_color(path):
    """
    Give each color in a layer a layer of its own, where the file separates its colors by mark rather
    than by group - which is how a flat illustration comes out of Illustrator or VectorCraft: four
    fills inside one <g id="Layer_1">. A layer is a pen, so four colors are four layers, and until
    2026-11-24 such a file opened as a single black one (Tom).

    Only groups the file hasn't declared to be layers are split: a drawing that names its own layers,
    Studio's and Inkscape's included, is left exactly as it is. Only whole children move, each with
    its own transform, so nothing is reshaped - a child drawn in two colors stops the split, since
    taking it apart would be guesswork.
    """
    tree = parse_svg(path)
    root = tree.getroot()
    if any(g.get(INKSCAPE_NS + "groupmode") == "layer" for g in root if g.tag == SVG_NS + "g"):
        return  # the file says which groups are its layers; they are not ours to rearrange
    strokes, fills = class_strokes(root), class_paints(root, "fill")
    illustrator = is_illustrator_svg(root)
    changed = False
    for group in layer_groups(root):
        # Each child, in file order, with the one color everything in it is drawn in.
        children = []
        for child in group:
            if not isinstance(child.tag, str):
                continue  # a comment or processing instruction: it rides along with the child above
            marks = [n for n in child.iter() if n.tag in SHAPE_TAGS]
            colors = {mark_color(m, group, strokes, fills) for m in marks}
            colors.discard(None)
            if not marks:
                children.append((child, None))  # <defs>, a title: no color, stays where the file put it
            elif len(colors) == 1:
                children.append((child, colors.pop()))
            else:
                children = None  # one child, two colors: splitting it would be guesswork
                break
        if children is None:
            continue
        order = []
        for _, color in children:
            if color and color not in order:
                order.append(color)
        if len(order) < 2 or len(order) > SPLIT_COLOR_LIMIT:
            continue
        # A color's name: what its marks are called, when they agree on a name worth keeping, else the
        # color itself. The file at hand names them "Blue", "Red" - better than any guess from a hex.
        parent = group.getparent()
        at = parent.index(group)  # the new layers stand exactly where the group they came from did
        made = {}
        for n, color in enumerate(order):
            names = {layer_name(child, illustrator) for child, c in children if c == color}
            names = {name for name in names if name and not MADE_UP_ID.match(name)}
            layer = etree.Element(SVG_NS + "g")
            layer.set(INKSCAPE_NS + "groupmode", "layer")
            layer.set(INKSCAPE_NS + "label", names.pop() if len(names) == 1 else color)
            layer.set("stroke", color)  # so every reader of this file agrees on the layer's color
            if group.get("transform"):
                layer.set("transform", group.get("transform"))
            parent.insert(at + n, layer)
            made[color] = layer
        # Anything with no color of its own - a <defs>, a <title> - goes with the first layer rather
        # than nowhere: the group that held it is about to go, and nothing in the file may be lost.
        for child, color in children:
            made[color if color else order[0]].append(child)
        parent.remove(group)
        changed = True
    if changed:
        # A file that never declared xmlns:inkscape gets the prefix lxml invents - ns1:label - which
        # is correct XML and unreadable to anyone expecting Inkscape's own. Say it once, at the top.
        etree.cleanup_namespaces(root, top_nsmap={"inkscape": INKSCAPE_NS[1:-1]})
        path.write_bytes(svg_bytes(tree))

def ensure_layer_ids(path):
    """Give every layer an id, so the page can refer to layers while they're renamed and reordered."""
    tree = parse_svg(path)
    root = tree.getroot()
    used = {el.get("id") for el in root.iter() if el.get("id")}
    changed = False
    for n, group in enumerate(layer_groups(root), start=1):
        if group.get("id"):
            continue
        candidate = f"{AUTO_LAYER_ID}{n}"
        while candidate in used:
            candidate += "_"
        group.set("id", candidate)
        used.add(candidate)
        changed = True
    if changed:
        path.write_bytes(svg_bytes(tree))

def normalize_size(root):
    """
    Give the document a width and height the NextDraw software can size, in inches, when it lacks
    one it understands. Illustrator writes coordinates in points (72 per inch) and, with its default
    "Responsive" export, no width/height at all; the SVG standard assumes 96 per inch.
    Returns a note for the user, or None.
    """
    def length(value):
        m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$", value or "", re.I)
        return (float(m.group(1)), m.group(2).lower()) if m else None

    illustrator = is_illustrator_svg(root)
    per_inch = ILLUSTRATOR_POINTS_PER_INCH if illustrator else 96.0
    width, height = length(root.get("width")), length(root.get("height"))
    vb = root.get("viewBox")
    vb = [float(v) for v in re.split(r"[\s,]+", vb.strip())] if vb else None

    note = None
    if not (width and height) or width[1] == "%" or height[1] == "%":
        if not vb:
            return None  # nothing to size from; the software reports it
        root.set("width", f"{vb[2] / per_inch:g}in")
        root.set("height", f"{vb[3] / per_inch:g}in")
        if illustrator:
            note = ("This Illustrator SVG was saved without a page size (Responsive on), so the page is "
                    "sized from its coordinates. If the artboard wasn't included, the page is just the "
                    "artwork's outline.")
    elif illustrator and width[1] in ("", "px") and height[1] in ("", "px"):
        # Illustrator's "px" are points.
        if not vb:
            root.set("viewBox", f"0 0 {width[0]:g} {height[0]:g}")
        root.set("width", f"{width[0] / per_inch:g}in")
        root.set("height", f"{height[0] / per_inch:g}in")
    return note

DISPLAY_RULE = re.compile(r"(?:^|;)\s*display\s*:\s*([^;]*)")

def layer_hidden(group):
    style = DISPLAY_RULE.search(group.get("style") or "")
    return (style and style.group(1).strip() == "none") or group.get("display") == "none" \
        or group.get("visibility") in ("hidden", "collapse")

def set_layer_hidden(group, hidden):
    style = DISPLAY_RULE.sub("", group.get("style") or "").strip(" ;")
    group.attrib.pop("display", None)
    if group.get("visibility") in ("hidden", "collapse"):
        group.attrib.pop("visibility")
    if hidden:
        group.set("style", f"{style};display:none" if style else "display:none")
    elif style:
        group.set("style", style)
    else:
        group.attrib.pop("style", None)

# Studio's hatch fills, regenerated at plot time. Studio writes each fill twice: as the lines it drew,
# in a group whose id is STUDIO_FILL_PREFIX + the fill's id, and as the parameters that made them, in
# its <nds:design> block. Plot never edits the drawing, but it may plot the fill differently: at a
# spacing found to suit the ink better (chosen per layer while plotting, kept in Plot's own block), or
# at a scale other than the one the lines were made for. Either way the lines are made again here, in
# the copy sent to the plotter and the preview, from the same parameters - the file is untouched.
#
# The geometry is a port of web/src/shared/lib/drawing/hatch.ts (hatchLines and hatchStroke) and has to stay
# in step with it: tests/hatch_matches_studio.py compares the two.
STUDIO_FILL_PREFIX = "studio-fill-"

PLOT_NS = "https://github.com/tomcog/NextDraw"
PLOT_TAG = "{%s}plot" % PLOT_NS
# Drawings saved before the app was renamed carry the same block under the old element name. They're
# read as they are and rewritten as <nds:plot> the next time the drawing is saved.
LEGACY_PLOT_TAG = "{%s}studio" % PLOT_NS
DESIGN_TAG = "{%s}design" % PLOT_NS

def design_margins(root):
    """The margins Studio laid the drawing out inside, in inches a side, from its design block: the
    live area the print is composed in, and what Plot places its blocks and signature against unless
    they are told otherwise (Tom, 2026-11-25). Zeros for a drawing that carries none."""
    none = {"top": 0.0, "right": 0.0, "bottom": 0.0, "left": 0.0}
    for node in root.iter(DESIGN_TAG):
        try:
            data = json.loads(node.text or "{}")
        except ValueError:
            return none
        kept = data.get("margins") if isinstance(data, dict) else None
        if not isinstance(kept, dict):
            return none
        out = {}
        for side in none:
            try:
                out[side] = max(0.0, float(kept.get(side, 0)))
            except (TypeError, ValueError):
                out[side] = 0.0
        return out
    return none

def studio_fills(root):
    """Studio's fills by id, from its design block; empty for a drawing Studio didn't make."""
    for node in root.iter(DESIGN_TAG):
        try:
            data = json.loads(node.text or "{}")
        except ValueError:
            return {}
        fills = data.get("fills") if isinstance(data, dict) else None
        return {f["id"]: f for f in fills or [] if isinstance(f, dict) and isinstance(f.get("id"), str)}
    return {}

def fill_spacing_of(group, fills):
    """The spacing (mm) Studio gave the fills on a layer - the first one's - or None if it has none."""
    for g in group.iter(SVG_NS + "g"):
        fill = fills.get((g.get("id") or "")[len(STUDIO_FILL_PREFIX):]) if (g.get("id") or "").startswith(STUDIO_FILL_PREFIX) else None
        if fill:
            try:
                return float(fill.get("spacing_mm"))
            except (TypeError, ValueError):
                return None
    return None

def page_mm_and_units(root, attr, index):
    """The page's width or height in mm and in the document's own units."""
    m = re.match(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$", root.get(attr) or "", re.I)
    if not m or m.group(2).lower() not in PX_PER_UNIT:
        raise RuntimeError("This SVG has no size the drawing's position can be measured against.")
    size_mm = float(m.group(1)) * PX_PER_UNIT[m.group(2).lower()] / PX_PER_UNIT["mm"]
    vb = root.get("viewBox")
    units = float(re.split(r"[\s,]+", vb.strip())[index]) if vb else float(m.group(1)) * PX_PER_UNIT[m.group(2).lower()]
    return size_mm, units

STYLE_DECL = re.compile(r"\s*([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)")

def hoist_styles(layer):
    """
    Say once on the layer what every mark in it says for itself. Illustrator writes the whole of a
    mark's look - fill, stroke, width, caps, joins, mitre limit - onto every one of tens of thousands
    of lines, which is most of a separation's size. A declaration every mark makes the same way moves
    to the layer; one that differs anywhere stays where it is, so nothing is drawn any differently.
    Left alone when anything in between could get in the way: a class on a mark (a class rule would
    then win over the layer), or the same property set as an attribute or on a group inside.
    """
    marks = [el for el in layer.iter() if el.tag in SHAPE_TAGS]
    if len(marks) < 2 or any(el.get("class") for el in marks):
        return
    common = None
    for el in marks:
        decls = dict(STYLE_DECL.findall(el.get("style") or ""))
        common = decls if common is None else {k: v for k, v in common.items() if decls.get(k) == v}
        if not common:
            return
    for el in layer.iter():
        if el is layer or not isinstance(el.tag, str):
            continue
        inside = el.tag not in SHAPE_TAGS
        for key in list(common):
            if el.get(key) is not None or (inside and key in dict(STYLE_DECL.findall(el.get("style") or ""))):
                del common[key]
    if not common:
        return
    own = dict(STYLE_DECL.findall(layer.get("style") or ""))
    own.update(common)
    layer.set("style", ";".join(f"{k}:{v}" for k, v in own.items()))
    for el in marks:
        left = [(k, v) for k, v in STYLE_DECL.findall(el.get("style") or "") if k not in common]
        if left:
            el.set("style", ";".join(f"{k}:{v}" for k, v in left))
        else:
            el.attrib.pop("style", None)

NON_DRAWING_TAGS = {SVG_NS + t for t in ("defs", "style", "metadata", "title", "desc")}

LENGTH = re.compile(r"^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$", re.I)

def page_frame(root):
    """
    Where a document's own units land on its page, in inches - on each axis, inch = s * (unit - min)
    + offset - and the page's size. The page is sized the way the NextDraw software sizes it
    (normalize_size, which this applies), so Illustrator's points stay points. None when nothing in
    the file gives it a size.
    """
    normalize_size(root)

    def inches(value):
        m = LENGTH.match(value or "")
        unit = m.group(2).lower() if m else None
        return float(m.group(1)) * PX_PER_UNIT[unit] / 96.0 if m and unit in PX_PER_UNIT else None

    w, h = inches(root.get("width")), inches(root.get("height"))
    if not w or not h:
        return None
    vb = root.get("viewBox")
    try:
        vb = [float(v) for v in re.split(r"[\s,]+", vb.strip())] if vb else [0.0, 0.0, w * 96, h * 96]
    except ValueError:
        return None
    if len(vb) != 4 or vb[2] <= 0 or vb[3] <= 0:
        return None
    sx, sy = w / vb[2], h / vb[3]
    ox = oy = 0.0
    fit = (root.get("preserveAspectRatio") or "xMidYMid meet").split()
    if fit[0] != "none":
        # A viewBox of another shape than its page is fitted into it, as a browser would.
        s = max(sx, sy) if "slice" in fit else min(sx, sy)
        ax = 0.0 if "xMin" in fit[0] else 1.0 if "xMax" in fit[0] else 0.5
        ay = 0.0 if "YMin" in fit[0] else 1.0 if "YMax" in fit[0] else 0.5
        ox, oy = (w - s * vb[2]) * ax, (h - s * vb[3]) * ay
        sx = sy = s
    return {"w": w, "h": h, "sx": sx, "sy": sy, "ox": ox, "oy": oy, "x": vb[0], "y": vb[1]}
