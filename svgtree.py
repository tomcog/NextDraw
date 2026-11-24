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

def class_strokes(root):
    """Stroke colors set by class in <style> blocks, e.g. .st0{stroke:#912474}."""
    strokes = {}
    for style in root.iter(SVG_NS + "style"):
        for selectors, body in re.findall(r"([^{}]+)\{([^}]*)\}", style.text or ""):
            match = re.search(r"(?:^|;)\s*stroke\s*:\s*([^;]+)", body)
            if not match:
                continue
            for selector in selectors.split(","):
                selector = selector.strip()
                if selector.startswith("."):
                    strokes[selector[1:]] = match.group(1).strip()
    return strokes

def stroke_of(node, by_class):
    match = re.search(r"(?:^|;)\s*stroke\s*:\s*([^;]+)", node.get("style") or "")
    if match:
        return match.group(1).strip()
    if node.get("stroke"):
        return node.get("stroke").strip()
    for cls in (node.get("class") or "").split():
        if cls in by_class:
            return by_class[cls]
    return None

SHAPE_TAGS = {SVG_NS + t for t in ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon")}

def read_layers(root):
    """The drawing's layers, top to bottom as they appear in the file: Inkscape layers if the file has them,
    otherwise the top-level groups (which is how Illustrator writes its layers)."""
    illustrator = is_illustrator_svg(root)
    groups = layer_groups(root)
    by_class = class_strokes(root)
    fills = studio_fills(root)
    layers = []
    for index, group in enumerate(groups):
        counts = {}
        shapes = 0
        for node in group.iter():
            if node.tag not in SHAPE_TAGS:
                continue
            shapes += 1
            color = None
            walk = node
            while walk is not None and color is None:  # stroke can be inherited from a parent group
                color = stroke_of(walk, by_class)
                walk = walk.getparent() if walk is not group else None
            if color and color.lower() != "none":
                counts[color.lower()] = counts.get(color.lower(), 0) + 1
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
