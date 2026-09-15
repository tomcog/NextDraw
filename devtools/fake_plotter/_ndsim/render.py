"""
Build the SVG that plot_run() hands back: the path preview the app draws, the flattened
"plob" the app measures a drawing from, and the progress copy a stopped plot resumes from.
"""

import copy

from lxml import etree

SVG_NS = "http://www.w3.org/2000/svg"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"
PREVIEW_LABEL = "% Preview"


def _label(element, text):
    element.set(f"{{{INKSCAPE_NS}}}label", text)


def _points(points):
    return " ".join(f"{x:.4f},{y:.4f}" for x, y in points)


def preview_svg(root, drawing, plan, rendering):
    """
    The source drawing with a preview layer of the pen's paths on top, in the document's own
    coordinates. `rendering` follows the NextDraw option: 1 pen-down, 2 pen-up, 3 both.
    """
    out = copy.deepcopy(root)
    for child in list(out):
        if child.tag == f"{{{SVG_NS}}}g" and child.get(f"{{{INKSCAPE_NS}}}label") == PREVIEW_LABEL:
            out.remove(child)  # don't stack previews if one is already there

    # Inches back into the document's user units, the reverse of the flattening.
    view_box = out.get("viewBox")
    box = [float(v) for v in view_box.replace(",", " ").split()] if view_box else None
    if box and box[2] and box[3]:
        scale_x, scale_y = box[2] / drawing.width_in, box[3] / drawing.height_in
        offset_x, offset_y = box[0], box[1]
    else:
        scale_x = scale_y = 96.0
        offset_x = offset_y = 0.0

    def to_user(point):
        return point[0] * scale_x + offset_x, point[1] * scale_y + offset_y

    layer = etree.SubElement(out, f"{{{SVG_NS}}}g", nsmap={"inkscape": INKSCAPE_NS})
    _label(layer, PREVIEW_LABEL)
    # Line widths are in user units, so scale a hairline to the document.
    hairline = 0.008 * (scale_x + scale_y) / 2

    if rendering & 2:
        up = etree.SubElement(layer, f"{{{SVG_NS}}}g")
        _label(up, "Pen-up movement")
        up.set("fill", "none")
        up.set("stroke", "#0000ff")
        up.set("stroke-width", f"{hairline:g}")
        for down, start, end, *_rest in plan.moves:
            if not down:
                etree.SubElement(up, f"{{{SVG_NS}}}polyline").set(
                    "points", _points([to_user(start), to_user(end)]))

    if rendering & 1:
        down_layer = etree.SubElement(layer, f"{{{SVG_NS}}}g")
        _label(down_layer, "Pen-down movement")
        down_layer.set("fill", "none")
        down_layer.set("stroke", "#ff0000")
        down_layer.set("stroke-width", f"{hairline:g}")
        for points in plan.paths:
            etree.SubElement(down_layer, f"{{{SVG_NS}}}polyline").set(
                "points", _points([to_user(p) for p in points]))

    return etree.tostring(out, encoding="unicode")


def plob_svg(drawing, plan):
    """
    The flattened drawing the real software calls a plob: polylines in inches, in a document
    whose viewBox is the page in inches.
    """
    root = etree.Element(f"{{{SVG_NS}}}svg", nsmap={None: SVG_NS, "inkscape": INKSCAPE_NS})
    root.set("viewBox", f"0 0 {drawing.width_in:.6g} {drawing.height_in:.6g}")
    root.set("width", f"{drawing.width_in:.6g}in")
    root.set("height", f"{drawing.height_in:.6g}in")
    group = etree.SubElement(root, f"{{{SVG_NS}}}g")
    _label(group, "digest")
    for points in plan.paths:
        etree.SubElement(group, f"{{{SVG_NS}}}polyline").set("points", _points(points))
    return etree.tostring(root, encoding="unicode")


def progress_svg(source_text, pendown_inches):
    """
    The copy of the drawing a stopped plot resumes from: the source with how far it got, in
    microns of pen-down travel, recorded on the root as the real software records it.
    """
    root = etree.fromstring(source_text.encode("utf-8"), etree.XMLParser(huge_tree=True))
    root.set("pause_dist", str(int(round(pendown_inches * 25.4 * 1000))))
    return etree.tostring(root, encoding="unicode")


def read_progress(source_text):
    """How far a resumed plot had already got, in inches of pen-down travel."""
    try:
        root = etree.fromstring(source_text.encode("utf-8"), etree.XMLParser(huge_tree=True))
    except etree.XMLSyntaxError:
        return 0.0
    value = root.get("pause_dist")
    try:
        return max(0.0, int(value) / 1000 / 25.4)
    except (TypeError, ValueError):
        return 0.0
