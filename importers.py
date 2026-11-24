"""Opening what other programs made: a VectorCraft file read out of its JSON, a Photoshop file's
channels, an ICC profile's inks, and several one-colour files combined into one drawing, a layer each
(Tom, 2026-11-24).

Each of these is a format this app does not own, read once on the way in and never again - which is
why they belong together and away from the rest: nothing here runs while a plot does.
"""
from lxml import etree
from nextdraw import NextDraw
from pathlib import Path
from svgtree import page_frame, LEGACY_PLOT_TAG, PLOT_NS, PLOT_TAG, AUTO_LAYER_ID, INKSCAPE_NS, SVG_NS, hoist_styles, is_illustrator_svg, layer_groups, layer_name
import json
import re
import shutil
import struct
import subprocess
import tempfile
import zlib

CARRIED_TAGS = {SVG_NS + t for t in ("defs", "style")}  # anything in the file may refer to these

CLASS_SELECTOR = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")

DROPPED_TAGS = {SVG_NS + t for t in ("metadata", "title", "desc")} | {
    "{http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd}namedview"}

# What a file's own <svg> can set for everything in it, and so what its layer has to carry instead.
INHERITED_ATTRS = ("style", "class", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
                   "stroke-miterlimit", "opacity")

TEXT_TAGS = {SVG_NS + t for t in ("text", "tspan", "textPath", "style")}

URL_REF = re.compile(r"url\(\s*['\"]?#([^)'\"\s]+)['\"]?\s*\)")

XLINK_HREF = "{http://www.w3.org/1999/xlink}href"

def vectorcraft_color(paint):
    """A paint's colour as hex, or None for no paint. A gradient is taken as its first stop."""
    if not isinstance(paint, dict):
        return None
    if paint.get("type") == "gradient":
        stops = ((paint.get("gradient") or {}).get("stops") or []) if isinstance(paint.get("gradient"), dict) else []
        return vectorcraft_color({"type": "solid", "color": stops[0].get("color")}) if stops and isinstance(stops[0], dict) else None
    if paint.get("type") != "solid":
        return None
    c = paint.get("color") or {}
    model = c.get("model")
    num = lambda k: max(0.0, min(1.0, float(c.get(k) or 0)))  # noqa: E731
    if model == "rgb":
        rgb = (num("r"), num("g"), num("b"))
    elif model == "cmyk":
        k = num("k")
        rgb = tuple((1 - num(ch)) * (1 - k) for ch in ("c", "m", "y"))
    elif model == "lab":
        rgb = lab_to_srgb(float(c.get("l") or 0), float(c.get("a") or 0), float(c.get("b") or 0))
    elif model in ("gray", "grey"):
        v = 1 - num("gray" if "gray" in c else "k")
        rgb = (v, v, v)
    else:
        rgb = (0.0, 0.0, 0.0)
    return "#" + "".join(f"{round(max(0.0, min(1.0, v)) * 255):02x}" for v in rgb)

def lab_to_srgb(L, a, b):
    """CIE Lab (D65) to sRGB, 0 to 1."""
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    f = lambda t: t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787  # noqa: E731
    x, y, z = 0.95047 * f(fx), 1.0 * f(fy), 1.08883 * f(fz)
    lin = (3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z,
           0.0557 * x - 0.2040 * y + 1.0570 * z)
    return tuple(12.92 * v if v <= 0.0031308 else 1.055 * max(v, 0) ** (1 / 2.4) - 0.055 for v in lin)

def vectorcraft_d(path):
    """A path's subpaths as SVG path data: a line where neither end has a handle out, a curve otherwise."""
    out = []
    fmt = lambda pt: f"{float(pt[0]):.4f},{float(pt[1]):.4f}".replace(".0000", "")  # noqa: E731
    for sub in (path or {}).get("subpaths") or []:
        anchors = [a for a in sub.get("anchors") or [] if isinstance(a, dict) and a.get("p")]
        if not anchors:
            continue
        out.append("M" + fmt(anchors[0]["p"]))
        pairs = list(zip(anchors, anchors[1:]))
        if sub.get("closed") and len(anchors) > 1:
            pairs.append((anchors[-1], anchors[0]))
        for a, b in pairs:
            h1, h2 = a.get("out") or a["p"], b.get("in") or b["p"]
            if list(h1) == list(a["p"]) and list(h2) == list(b["p"]):
                out.append("L" + fmt(b["p"]))
            else:
                out.append(f"C{fmt(h1)} {fmt(h2)} {fmt(b['p'])}")
        if sub.get("closed"):
            out.append("Z")
    return "".join(out)

def vectorcraft_pen(swatch, presets):
    """The pen color a swatch names: "EnerGel Pink" is Pink - a pen preset's name before it taken off,
    and the color spelt as that preset's palette spells it. Any other swatch is its own name."""
    found = None
    for preset in sorted(presets or [], key=lambda p: -len(str(p.get("name") or ""))):
        tool = str(preset.get("name") or "")
        if tool and swatch.lower().startswith(tool.lower() + " "):
            color = swatch[len(tool):].strip()
            known = [str(c.get("name")) for c in preset.get("palette") or [] if isinstance(c, dict) and c.get("name")]
            spelt = next((k for k in known if k.lower() == color.lower()), None)
            if spelt:
                return spelt
            found = found or color
    return found or swatch

def vectorcraft_layer_name(name, layer, presets):
    """
    A layer named after its pen, as Studio names them: when every fill in it is the same swatch, that
    swatch's pen color - with the layer's own name after it ("Pink - Petals"), unless that's just
    VectorCraft's "Layer 2". Otherwise the layer's own name.
    """
    swatches, unnamed = set(), False

    def walk(node):
        nonlocal unnamed
        kind = node.get("kind") or {}
        if kind.get("type") == "path":
            for item in ((node.get("appearance") or {}).get("items") or []):
                paint = item.get("paint") if isinstance(item, dict) and item.get("kind") == "fill" else None
                if paint and paint.get("type") != "none":
                    if paint.get("swatch"):
                        swatches.add(str(paint["swatch"]))
                    else:
                        unnamed = True
        for child in kind.get("children") or []:
            if isinstance(child, dict):
                walk(child)

    walk(layer)
    own = str(name or "").strip()
    if len(swatches) != 1 or unnamed:
        return own or "Layer"
    pen = vectorcraft_pen(swatches.pop(), presets)
    return pen if not own or re.fullmatch(r"Layer \d+", own) or own.lower() == pen.lower() else f"{pen} - {own}"

def vectorcraft_svg(doc, presets=None):
    """A VectorCraft document as SVG text, and the kinds of thing in it that couldn't come across.
    `presets` are the pen presets, for naming layers after their pens."""
    from lxml import etree
    d = doc.get("document") or {}
    boards = d.get("artboards") or []
    rect = (boards[0].get("rect") if boards and isinstance(boards[0], dict) else None) or {}
    x0, y0 = float(rect.get("x0", 0)), float(rect.get("y0", 0))
    w, h = float(rect.get("x1", 792)) - x0, float(rect.get("y1", 612)) - y0
    left_out = []
    root = etree.Element(SVG_NS + "svg", nsmap={None: SVG_NS[1:-1], "inkscape": INKSCAPE_NS[1:-1]})
    root.set("width", f"{w / 72:g}in")
    root.set("height", f"{h / 72:g}in")
    root.set("viewBox", f"{x0:g} {y0:g} {w:g} {h:g}")

    def paint_attrs(el, node):
        fill, stroke, width = None, None, None
        for item in ((node.get("appearance") or {}).get("items") or []):
            if not isinstance(item, dict) or item.get("visible") is False:
                continue
            if item.get("kind") == "fill" and fill is None:
                fill = vectorcraft_color(item.get("paint")) or "none"
            elif item.get("kind") == "stroke" and stroke is None:
                stroke = vectorcraft_color(item.get("paint")) or "none"
                width = item.get("width")
        el.set("fill", fill or "none")
        if stroke and stroke != "none":
            el.set("stroke", stroke)
            el.set("stroke-width", f"{float(width or 1):g}")

    def hide(el, node, kind):
        if kind.get("visible") is False or node.get("visible") is False or kind.get("printable") is False:
            el.set("style", "display:none")

    def add(parent, node):
        kind = node.get("kind") or {}
        what = kind.get("type")
        if what in ("layer", "group"):
            g = etree.SubElement(parent, SVG_NS + "g")
            if node.get("id") is not None:
                g.set("id", f"vc{node['id']}")
            name = kind.get("name") or node.get("name")
            if what == "layer":
                g.set(INKSCAPE_NS + "groupmode", "layer")
                g.set(INKSCAPE_NS + "label", vectorcraft_layer_name(name, node, presets))
            elif name:
                g.set(INKSCAPE_NS + "label", str(name))
            hide(g, node, kind)
            for child in kind.get("children") or []:
                if isinstance(child, dict):
                    add(g, child)
        elif what == "path":
            path_data = vectorcraft_d(kind.get("path"))
            if not path_data:
                return
            el = etree.SubElement(parent, SVG_NS + "path")
            if node.get("id") is not None:
                el.set("id", f"vc{node['id']}")
            el.set("d", path_data)
            paint_attrs(el, node)
            if "EvenOdd" in json.dumps(kind.get("path", {}).get("fill_rule", kind.get("fill_rule", ""))):
                el.set("fill-rule", "evenodd")
            hide(el, node, kind)
        else:
            left_out.append(what or "unknown")

    for layer in d.get("layers") or []:
        if isinstance(layer, dict):
            add(root, layer)
    root.text = "\n"
    head = f"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- Generator: {doc.get('generator') or 'VectorCraft'}, read by NextDraw -->\n"
    return head + etree.tostring(root, encoding="unicode"), left_out

COMBINED_ATTR = "{%s}combined" % PLOT_NS  # on a drawing this made: adding a file to it rewrites it

def names_in(root):
    """Every id and class a document uses."""
    used = set()
    for el in root.iter():
        if isinstance(el.tag, str):
            used.update(filter(None, [el.get("id")]))
            used.update((el.get("class") or "").split())
    return used

def keep_apart(root, prefix):
    """
    Put a prefix on every id and class in a file, and on everything that refers to them. Illustrator
    names its classes .st0, .st1 ... in every file it exports, so two files stacked as they are would
    share a class - and whichever file's style came last would colour both.
    """
    ids = {el.get("id") for el in root.iter() if isinstance(el.tag, str) and el.get("id")}

    def ref(m):
        return f"url(#{prefix}{m.group(1)})" if m.group(1) in ids else m.group(0)

    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        if el.get("id"):
            el.set("id", prefix + el.get("id"))
        if el.get("class"):
            el.set("class", " ".join(prefix + c for c in el.get("class").split()))
        for attr, value in list(el.attrib.items()):
            if attr in ("href", XLINK_HREF) and value.startswith("#") and value[1:] in ids:
                el.set(attr, "#" + prefix + value[1:])
            elif "url(" in value:
                el.set(attr, URL_REF.sub(ref, value))
    for style in root.iter(SVG_NS + "style"):
        # Selectors sit outside the braces and declarations inside them. Every class selector is
        # prefixed, used or not: an unused .st1 left as it is would reach the other files' .st1.
        parts = re.split(r"(\{[^}]*\})", style.text or "")
        style.text = "".join(
            URL_REF.sub(ref, p) if p.startswith("{") else CLASS_SELECTOR.sub(lambda m: f".{prefix}{m.group(1)}", p)
            for p in parts
        )

def unused_prefix(used):
    n = 1
    while any(name.startswith(f"c{n}-") for name in used):
        n += 1
    return f"c{n}-"

def drop_indentation(layer):
    """The line breaks and tabs an exporter lays its file out with, which say nothing inside a layer."""
    for el in layer.iter():
        if not isinstance(el.tag, str) or el.tag in TEXT_TAGS:
            continue
        if el.text is not None and not el.text.strip():
            el.text = None
        parent = el.getparent()
        if el.tail is not None and not el.tail.strip() and (parent is None or parent.tag not in TEXT_TAGS):
            el.tail = None

def as_layer(root, name, transform):
    """
    A file's drawing as one layer, and what it keeps at the top of its document (its defs and style),
    which have to move to the top of the combined one. What the file's own <svg> set for everything in
    it moves onto the layer, and layers the file had inside it become plain groups: it is one layer now.
    """
    from lxml import etree
    layer = etree.Element(SVG_NS + "g")
    layer.set(INKSCAPE_NS + "groupmode", "layer")
    layer.set(INKSCAPE_NS + "label", name)
    for attr in INHERITED_ATTRS:
        if root.get(attr):
            layer.set(attr, root.get(attr))
    if transform:
        layer.set("transform", transform)
    carried = []
    for child in list(root):
        if not isinstance(child.tag, str) or child.tag in DROPPED_TAGS or child.tag in (PLOT_TAG, LEGACY_PLOT_TAG):
            continue
        (carried if child.tag in CARRIED_TAGS else layer).append(child)
    for group in layer.iter(SVG_NS + "g"):
        if group is not layer:
            group.attrib.pop(INKSCAPE_NS + "groupmode", None)
    hoist_styles(layer)
    drop_indentation(layer)
    layer.tail = "\n"
    return layer, carried

def make_layers_explicit(root):
    """
    Mark a drawing's layers as layers. A file with no Inkscape layers has its top-level groups read as
    its layers (Illustrator's way), and one Inkscape layer added beside them would hide every one.
    """
    if any(g.get(INKSCAPE_NS + "groupmode") == "layer" for g in root if g.tag == SVG_NS + "g"):
        return
    illustrator = is_illustrator_svg(root)
    for group in layer_groups(root):
        group.set(INKSCAPE_NS + "groupmode", "layer")
        name = layer_name(group, illustrator)
        if name and not group.get(INKSCAPE_NS + "label"):
            group.set(INKSCAPE_NS + "label", name)

SAME_PAGE_IN = 0.5 / 25.4  # pages within half a millimetre of each other are the same page

def combine_drawings(parts, base=None):
    """
    Stack files into one drawing, a layer each. `parts` is (name, root) for each file, bottom first:
    the first is layer 1 and plots first. With a `base` - a drawing already open - they are added on
    top of it and it keeps its page and its layers as they were; without one, the first file's page is
    the page. Each file keeps its place on its own page, so files exported from one artboard register
    exactly. Returns the combined root, and the names of any files whose page isn't the same size,
    which will need lining up by hand.
    """
    from lxml import etree
    if base is None:
        first_name, first = parts[0]
        frame = page_frame(first)
        if frame is None:
            raise ValueError(f"{first_name} has no page size, so there's nothing to line the others up to.")
        out = etree.Element(SVG_NS + "svg", nsmap={None: SVG_NS[1:-1], "inkscape": INKSCAPE_NS[1:-1], "nds": PLOT_NS})
        for attr in ("width", "height", "viewBox", "preserveAspectRatio"):
            if first.get(attr):
                out.set(attr, first.get(attr))
    else:
        out = base
        frame = page_frame(out)
        if frame is None:
            raise ValueError("The open drawing has no page size, so there's nothing to line the files up to.")
        make_layers_explicit(out)
    out.set(COMBINED_ATTR, "true")

    used = names_in(out)
    mismatched = []
    for name, root in parts:
        f = page_frame(root)
        if f is None:
            raise ValueError(f"{name} has no page size, so there's nothing to line it up by.")
        if abs(f["w"] - frame["w"]) > SAME_PAGE_IN or abs(f["h"] - frame["h"]) > SAME_PAGE_IN:
            mismatched.append(name)
        prefix = unused_prefix(used)
        keep_apart(root, prefix)
        used |= names_in(root)
        # This file's units into the page's: each is a scale and a shift, so the two together are too.
        kx, ky = f["sx"] / frame["sx"], f["sy"] / frame["sy"]
        tx = (f["ox"] - frame["ox"] - f["sx"] * f["x"]) / frame["sx"] + frame["x"]
        ty = (f["oy"] - frame["oy"] - f["sy"] * f["y"]) / frame["sy"] + frame["y"]
        same = abs(kx - 1) < 1e-9 and abs(ky - 1) < 1e-9 and abs(tx) < 1e-9 and abs(ty) < 1e-9
        layer, carried = as_layer(root, name, None if same else f"matrix({kx:.10g} 0 0 {ky:.10g} {tx:.10g} {ty:.10g})")
        layer_id = f"{AUTO_LAYER_ID}{len(layer_groups(out)) + 1}"
        while layer_id in used:
            layer_id += "_"
        layer.set("id", layer_id)
        used.add(layer_id)
        out.extend(carried)
        out.append(layer)
    return out, mismatched

# ---- Pictures the browser can't read ----
# A TIFF - a layered one saved from Photoshop included - or an iPhone's HEIC: Chrome reads neither.
# macOS's own converter does, and it reads what Photoshop saves for other programs to see: the picture
# flattened, adjustment layers and all. It comes back as one PNG, no larger than Image ever needs.
FLAT_IMAGE_EDGE = 2400

INK_SPACES = {"CMYK": 4, **{f"{n:X}CLR": n for n in range(2, 16)}}

def profile_info(path):
    """A profile Image can split a photo by, as {name, file, inks, names, black}, or None."""
    try:
        with open(path, "rb") as f:
            head = f.read(132)
            if len(head) < 132 or head[36:40] != b"acsp" or head[12:16] != b"prtr" or head[20:24] != b"Lab ":
                return None
            inks = INK_SPACES.get(head[16:20].decode("latin1"))
            if not inks:
                return None
            count, = struct.unpack(">I", head[128:132])
            table = f.read(12 * count)
            tags = {}
            for i in range(count):
                sig, off, size = struct.unpack(">4sII", table[12 * i:12 * i + 12])
                tags[sig] = (off, size)
            if b"B2A0" not in tags:
                return None
            f.seek(tags[b"B2A0"][0])
            # The 16- and 8-bit tables, and version 4's (IA ECG B1C X has only those).
            if f.read(4) not in (b"mft2", b"mft1", b"mBA "):
                return None
            name = path.stem
            if b"desc" in tags:
                f.seek(tags[b"desc"][0])
                desc = f.read(min(tags[b"desc"][1], 2048))
                name = profile_name(desc) or name
            # What it separates into, by name - Cyan, Magenta, ... Orange, Green, Violet - which is
            # what says what a profile is for. Its colorant table, as the page reads it (icc.ts).
            inks_named = []
            if b"clrt" in tags:
                f.seek(tags[b"clrt"][0])
                clrt = f.read(min(tags[b"clrt"][1], 12 + 38 * 16))
                if clrt[:4] == b"clrt" and len(clrt) >= 12:
                    n, = struct.unpack(">I", clrt[8:12])
                    if n == inks and len(clrt) >= 12 + 38 * n:
                        inks_named = [clrt[12 + 38 * i:12 + 38 * i + 32].split(b"\0")[0].decode("latin1").strip() for i in range(n)]
                        inks_named = [ink for ink in inks_named if ink] if all(inks_named) else []
    except (OSError, struct.error, UnicodeDecodeError):
        return None
    # Some name themselves after their file: "Ink set.icc" reads as "Ink set".
    # Whether it says where its inks' black is: black point compensation has nothing to work from without.
    return {"name": re.sub(r"\.ic[cm]$", "", name, flags=re.I) or path.stem, "file": path.name, "inks": inks, "names": inks_named, "black": b"bkpt" in tags}

def profile_name(desc):
    """The name a profile's description tag gives: the old ASCII kind or the newer Unicode one."""
    if desc[:4] == b"desc" and len(desc) >= 12:
        n, = struct.unpack(">I", desc[8:12])
        return desc[12:12 + n].split(b"\0")[0].decode("latin1").strip()
    if desc[:4] == b"mluc" and len(desc) >= 28:
        size, off = struct.unpack(">II", desc[20:28])
        return desc[off:off + size].decode("utf-16-be", "replace").rstrip("\0").strip()
    return ""

# ---- Multichannel Photoshop files ----
# A Photoshop document in Multichannel mode is a picture already separated: a grayscale channel per
# ink - Cyan, Magenta, Orange, Violet... - darker where more of it goes, each named and given its ink's
# color. macOS's converter can't read one at all, so it's read here: the merged channels (never the
# layers), raw or run-length packed, 8 or 16 bits, from a PSD or a PSB. Image opens the channels as
# separations, a layer each.
PSD_MULTICHANNEL = 7

PSD_CMYK = 4

# A CMYK file's four plates, in the order Photoshop keeps them. The file names them nowhere - being
# CMYK is what says what they are - so they are named here, in the inks and colours the app's own
# plates use (PLATE_AIMS in photo.ts), which is how each one finds its pen by name.
CMYK_CHANNELS = (("Cyan", "#00a3e0"), ("Magenta", "#d6007a"), ("Yellow", "#ffe500"), ("Black", "#1a1a1a"))

def psd_channels(data):
    """A Multichannel or CMYK PSD or PSB as [{name, color, png}], or None when it's any other
    picture - another mode, or not a Photoshop file - which the converter reads as usual.

    Both modes keep a plane a channel, and keep it the way this app wants an ink: 0 is all of that
    ink, 255 none of it. (Photoshop is often said to store CMYK inverted; that is inverted from ink
    as a fraction, and it lands exactly on the app's own way round, so nothing is flipped here.)
    What differs is that a Multichannel file names and colours its channels and a CMYK file doesn't -
    they are the four plates, and nothing else in it is ink."""
    if len(data) < 26 or data[:4] != b"8BPS":
        return None
    version, = struct.unpack(">H", data[4:6])
    count, height, width, depth, mode = struct.unpack(">HIIHH", data[12:26])
    if version not in (1, 2) or depth not in (8, 16) or not count:
        return None
    # A CMYK file may carry alpha channels after its plates; those are masks, not ink, and are left.
    if mode == PSD_CMYK:
        if count < len(CMYK_CHANNELS):
            return None
    elif mode != PSD_MULTICHANNEL:
        return None
    big = version == 2
    at = 26
    skip, = struct.unpack(">I", data[at:at + 4])  # color mode data: none in Multichannel
    at += 4 + skip
    size, = struct.unpack(">I", data[at:at + 4])
    names, colors = psd_channel_info(data[at + 4:at + 4 + size])
    at += 4 + size
    skip = int.from_bytes(data[at:at + (8 if big else 4)], "big")  # layers: the merged image is after
    at += (8 if big else 4) + skip
    compression, = struct.unpack(">H", data[at:at + 2])
    at += 2
    row = width * depth // 8
    planes = []
    if compression == 0:
        for _ in range(count):
            planes.append(data[at:at + row * height])
            at += row * height
    elif compression == 1:
        step = 4 if big else 2
        lengths = [int.from_bytes(data[at + i * step:at + i * step + step], "big") for i in range(count * height)]
        at += count * height * step
        for c in range(count):
            plane = bytearray()
            for r in range(height):
                n = lengths[c * height + r]
                plane += unpack_bits(data[at:at + n], row)
                at += n
            planes.append(bytes(plane))
    else:
        return None
    if depth == 16:
        planes = [p[::2] for p in planes]  # the high byte of each: 8 bits is all a pen needs
    if mode == PSD_CMYK:
        return [{
            "name": name,
            "color": colour,
            "png": gray_png(planes[i], width, height),
        } for i, (name, colour) in enumerate(CMYK_CHANNELS) if len(planes[i]) >= width * height]
    return [{
        "name": names[i] if i < len(names) and names[i] else f"Channel {i + 1}",
        "color": colors[i] if i < len(colors) else None,
        "png": gray_png(planes[i], width, height),
    } for i in range(count) if len(planes[i]) >= width * height]

def unpack_bits(src, length):
    """One row of Photoshop's run-length packing (PackBits), unpacked to `length` bytes."""
    out = bytearray()
    i = 0
    while i < len(src) and len(out) < length:
        n = src[i]
        i += 1
        if n < 128:
            out += src[i:i + n + 1]
            i += n + 1
        elif n > 128:
            out += src[i:i + 1] * (257 - n)
            i += 1
    return bytes(out[:length]).ljust(length, b"\xff")

def psd_channel_info(resources):
    """The channels' names and ink colors (hex, or None) from a PSD's image resources."""
    names, colors, old_colors, old_names = [], [], [], []
    at = 0
    while at + 12 <= len(resources) and resources[at:at + 4] == b"8BIM":
        rid, = struct.unpack(">H", resources[at + 4:at + 6])
        n = resources[at + 6]
        at += 6 + 1 + n + ((1 + n) % 2)  # the resource's name, padded to even
        size, = struct.unpack(">I", resources[at:at + 4])
        block = resources[at + 4:at + 4 + size]
        at += 4 + size + (size % 2)
        if rid == 1045:  # the channels' names, in Unicode
            b = 0
            while b + 4 <= len(block):
                k, = struct.unpack(">I", block[b:b + 4])
                names.append(block[b + 4:b + 4 + 2 * k].decode("utf-16-be", "replace").rstrip("\x00"))
                b += 4 + 2 * k
        elif rid == 1006:  # the same, as Pascal strings, from older Photoshops
            b = 0
            while b < len(block):
                k = block[b]
                old_names.append(block[b + 1:b + 1 + k].decode("mac_roman", "replace"))
                b += 1 + k
        elif rid == 1077:  # each channel's ink: color, opacity, kind
            colors = [psd_color(block[b:b + 10]) for b in range(4, len(block) - 12, 13)]
        elif rid == 1007:  # the same, older
            old_colors = [psd_color(block[b:b + 10]) for b in range(0, len(block) - 13, 14)]
    return names or old_names, colors or old_colors

def psd_color(raw):
    """A Photoshop color - space, then four 16-bit numbers - as hex, or None for a space not read."""
    space, c0, c1, c2, c3 = struct.unpack(">HHHHH", raw)
    if space == 0:  # RGB
        return "#%02x%02x%02x" % (c0 >> 8, c1 >> 8, c2 >> 8)
    if space == 2:  # CMYK, 0 meaning all the ink
        c, m, y, k = (1 - v / 65535 for v in (c0, c1, c2, c3))
        return "#%02x%02x%02x" % tuple(round(255 * (1 - v) * (1 - k)) for v in (c, m, y))
    if space == 7:  # Lab: L 0-10000, a and b signed hundredths
        signed = lambda v: v - 65536 if v > 32767 else v
        return lab_hex(c0 / 100, signed(c1) / 100, signed(c2) / 100)
    if space == 8:  # gray, 0-10000 of black
        g = round(255 * (1 - c0 / 10000))
        return "#%02x%02x%02x" % (g, g, g)
    return None

def lab_hex(L, a, b):
    """A Lab color (D50, as Photoshop's) as sRGB hex."""
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    f = lambda t: t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787
    x, y, z = 0.9642 * f(fx), 1.0 * f(fy), 0.8249 * f(fz)
    # Straight from D50 XYZ to linear sRGB, Bradford-adapted to sRGB's D65.
    r = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z
    g = -0.9787684 * x + 1.9161415 * y + 0.0334540 * z
    bl = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z
    gamma = lambda v: 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    return "#%02x%02x%02x" % tuple(round(255 * min(1, max(0, gamma(v)))) for v in (r, g, bl))

def gray_png(plane, width, height):
    """8-bit grayscale pixels, a row after another, as a PNG - no larger than Image ever needs."""
    raw = b"".join(b"\x00" + plane[y * width:(y + 1) * width] for y in range(height))
    chunk = lambda kind, body: struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    if max(width, height) <= FLAT_IMAGE_EDGE or not shutil.which("sips"):
        return png
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.png"
        src.write_bytes(png)
        try:
            subprocess.run(["sips", "-Z", str(FLAT_IMAGE_EDGE), str(src)], capture_output=True, timeout=120, check=True)
            return src.read_bytes()
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return png
