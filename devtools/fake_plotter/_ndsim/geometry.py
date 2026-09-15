"""
Flatten an SVG into the polylines a pen would draw, in inches from the page's top-left.

This stands in for the geometry the NextDraw software does inside plot_run(). It follows the
same rules the real software does as far as this app relies on them: every visible drawable
element is plotted as an outline (fill is ignored), elements hidden with display/visibility are
skipped, and the page's width/height give the scale for its viewBox coordinates.

It is an approximation: no clipping masks, no <use>/<image>/<text>, no CSS stylesheets, no
stroke geometry (a stroke is one line down its centre, whatever its width).
"""

import math
import re

# How far a flattened curve may sit from the true curve, in inches. Small enough that the
# preview and the line-length figures look right at plotter scale.
CURVE_TOLERANCE_IN = 0.002

PX_PER_UNIT = {"": 1.0, "px": 1.0, "pt": 96.0 / 72, "pc": 16.0, "mm": 96.0 / 25.4,
               "cm": 96.0 / 2.54, "in": 96.0, "q": 96.0 / 101.6}
LENGTH = re.compile(r"^\s*([-+]?[0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$", re.I)
NUMBER = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
PATH_TOKEN = re.compile(r"([MmZzLlHhVvCcSsQqTtAa])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)")
TRANSFORM = re.compile(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)", re.I)
DISPLAY = re.compile(r"(?:^|;)\s*display\s*:\s*([^;]*)")
VISIBILITY = re.compile(r"(?:^|;)\s*visibility\s*:\s*([^;]*)")
SVG_NS = "{http://www.w3.org/2000/svg}"

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def multiply(m, n):
    """m then n, as SVG nests them: the outer transform is applied to the inner one's output."""
    a1, b1, c1, d1, e1, f1 = m
    a2, b2, c2, d2, e2, f2 = n
    return (a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
            a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
            a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1)


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def parse_transform(value):
    matrix = IDENTITY
    for name, args in TRANSFORM.findall(value or ""):
        nums = [float(v) for v in NUMBER.findall(args)]
        name = name.lower()
        if name == "matrix" and len(nums) == 6:
            step = tuple(nums)
        elif name == "translate":
            step = (1, 0, 0, 1, nums[0] if nums else 0, nums[1] if len(nums) > 1 else 0)
        elif name == "scale":
            sx = nums[0] if nums else 1
            step = (sx, 0, 0, nums[1] if len(nums) > 1 else sx, 0, 0)
        elif name == "rotate" and nums:
            angle = math.radians(nums[0])
            cos, sin = math.cos(angle), math.sin(angle)
            step = (cos, sin, -sin, cos, 0, 0)
            if len(nums) >= 3:  # rotate about a point
                step = multiply(multiply((1, 0, 0, 1, nums[1], nums[2]), step),
                                (1, 0, 0, 1, -nums[1], -nums[2]))
        elif name == "skewx" and nums:
            step = (1, 0, math.tan(math.radians(nums[0])), 1, 0, 0)
        elif name == "skewy" and nums:
            step = (1, math.tan(math.radians(nums[0])), 0, 1, 0, 0)
        else:
            continue
        matrix = multiply(matrix, step)
    return matrix


def length_px(value, percent_of=None):
    """A length in CSS px (96 per inch), or None."""
    m = LENGTH.match(value or "")
    if not m:
        return None
    number, unit = float(m.group(1)), m.group(2).lower()
    if unit == "%":
        return None if percent_of is None else number / 100 * percent_of
    return number * PX_PER_UNIT[unit] if unit in PX_PER_UNIT else None


def hidden(el):
    style = el.get("style") or ""
    display = DISPLAY.search(style)
    visibility = VISIBILITY.search(style)
    return ((display and display.group(1).strip() == "none")
            or el.get("display") == "none"
            or (visibility and visibility.group(1).strip() in ("hidden", "collapse"))
            or el.get("visibility") in ("hidden", "collapse"))


def flatten_cubic(points, x0, y0, x1, y1, x2, y2, x3, y3, tolerance, depth=0):
    """Subdivide until the control points sit within `tolerance` of the chord."""
    dx, dy = x3 - x0, y3 - y0
    span = math.hypot(dx, dy)
    if depth < 18 and span > 0:
        d1 = abs((x1 - x3) * dy - (y1 - y3) * dx)
        d2 = abs((x2 - x3) * dy - (y2 - y3) * dx)
        flat = (d1 + d2) ** 2 <= tolerance * span ** 2 * 16
    else:
        flat = True
    if flat or depth >= 18:
        points.append((x3, y3))
        return
    # de Casteljau split at the midpoint
    x01, y01 = (x0 + x1) / 2, (y0 + y1) / 2
    x12, y12 = (x1 + x2) / 2, (y1 + y2) / 2
    x23, y23 = (x2 + x3) / 2, (y2 + y3) / 2
    xa, ya = (x01 + x12) / 2, (y01 + y12) / 2
    xb, yb = (x12 + x23) / 2, (y12 + y23) / 2
    xm, ym = (xa + xb) / 2, (ya + yb) / 2
    flatten_cubic(points, x0, y0, x01, y01, xa, ya, xm, ym, tolerance, depth + 1)
    flatten_cubic(points, xm, ym, xb, yb, x23, y23, x3, y3, tolerance, depth + 1)


def arc_points(x0, y0, rx, ry, rotation, large_arc, sweep, x1, y1, tolerance):
    """Endpoint-notation elliptical arc, sampled finely enough for `tolerance`."""
    if rx == 0 or ry == 0 or (x0 == x1 and y0 == y1):
        return [(x1, y1)]
    rx, ry = abs(rx), abs(ry)
    angle = math.radians(rotation)
    cos, sin = math.cos(angle), math.sin(angle)
    dx2, dy2 = (x0 - x1) / 2, (y0 - y1) / 2
    x1p, y1p = cos * dx2 + sin * dy2, -sin * dx2 + cos * dy2
    # Grow the radii if they're too small to span the two points, as the spec says to.
    lam = (x1p / rx) ** 2 + (y1p / ry) ** 2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    denom = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    factor = 0.0 if denom == 0 else max(0.0, (rx ** 2 * ry ** 2 - denom) / denom)
    coef = math.sqrt(factor) * (-1 if large_arc == sweep else 1)
    cxp, cyp = coef * rx * y1p / ry, -coef * ry * x1p / rx
    cx = cos * cxp - sin * cyp + (x0 + x1) / 2
    cy = sin * cxp + cos * cyp + (y0 + y1) / 2

    def angle_of(ux, uy):
        return math.atan2(uy, ux)

    start = angle_of((x1p - cxp) / rx, (y1p - cyp) / ry)
    end = angle_of((-x1p - cxp) / rx, (-y1p - cyp) / ry)
    sweep_angle = end - start
    if not sweep and sweep_angle > 0:
        sweep_angle -= 2 * math.pi
    elif sweep and sweep_angle < 0:
        sweep_angle += 2 * math.pi
    # One step per tolerance-sized chord on the larger radius.
    radius = max(rx, ry)
    steps = max(2, int(abs(sweep_angle) / (2 * math.acos(max(-1.0, min(1.0, 1 - tolerance / radius))) or 0.1)) + 1)
    steps = min(steps, 2000)
    points = []
    for i in range(1, steps + 1):
        theta = start + sweep_angle * i / steps
        px, py = rx * math.cos(theta), ry * math.sin(theta)
        points.append((cos * px - sin * py + cx, sin * px + cos * py + cy))
    return points


def path_subpaths(d, tolerance):
    """Flatten a path's `d` into subpaths: lists of points in the element's own coordinates."""
    tokens = [(c, n) for c, n in PATH_TOKEN.findall(d or "")]
    subpaths, current = [], []
    x = y = start_x = start_y = 0.0
    last_cubic = last_quad = None
    command = None
    i = 0

    def number():
        nonlocal i
        while i < len(tokens) and tokens[i][0]:
            i += 1  # a command where a number was expected: stop reading this run
        if i >= len(tokens):
            raise StopIteration
        value = float(tokens[i][1])
        i += 1
        return value

    while i < len(tokens):
        if tokens[i][0]:
            command = tokens[i][0]
            i += 1
            if command in "Zz":
                if current:
                    current.append((start_x, start_y))
                    subpaths.append(current)
                    current = []
                x, y = start_x, start_y
                last_cubic = last_quad = None
                continue
        if command is None:
            i += 1
            continue
        relative = command.islower()
        op = command.upper()
        try:
            if op == "M":
                nx, ny = number(), number()
                x, y = (x + nx, y + ny) if relative else (nx, ny)
                if current:
                    subpaths.append(current)
                current = [(x, y)]
                start_x, start_y = x, y
                command = "l" if relative else "L"  # further pairs are implicit lineto
                last_cubic = last_quad = None
            elif op == "L":
                nx, ny = number(), number()
                x, y = (x + nx, y + ny) if relative else (nx, ny)
                current.append((x, y))
                last_cubic = last_quad = None
            elif op == "H":
                nx = number()
                x = x + nx if relative else nx
                current.append((x, y))
                last_cubic = last_quad = None
            elif op == "V":
                ny = number()
                y = y + ny if relative else ny
                current.append((x, y))
                last_cubic = last_quad = None
            elif op in ("C", "S"):
                if op == "C":
                    c1x, c1y = number(), number()
                    if relative:
                        c1x, c1y = x + c1x, y + c1y
                else:
                    c1x, c1y = (2 * x - last_cubic[0], 2 * y - last_cubic[1]) if last_cubic else (x, y)
                c2x, c2y = number(), number()
                nx, ny = number(), number()
                if relative:
                    c2x, c2y, nx, ny = x + c2x, y + c2y, x + nx, y + ny
                if not current:
                    current = [(x, y)]
                flatten_cubic(current, x, y, c1x, c1y, c2x, c2y, nx, ny, tolerance)
                last_cubic, last_quad = (c2x, c2y), None
                x, y = nx, ny
            elif op in ("Q", "T"):
                if op == "Q":
                    qx, qy = number(), number()
                    if relative:
                        qx, qy = x + qx, y + qy
                else:
                    qx, qy = (2 * x - last_quad[0], 2 * y - last_quad[1]) if last_quad else (x, y)
                nx, ny = number(), number()
                if relative:
                    nx, ny = x + nx, y + ny
                # A quadratic is a cubic with the control points a third of the way in.
                c1x, c1y = x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y)
                c2x, c2y = nx + 2 / 3 * (qx - nx), ny + 2 / 3 * (qy - ny)
                if not current:
                    current = [(x, y)]
                flatten_cubic(current, x, y, c1x, c1y, c2x, c2y, nx, ny, tolerance)
                last_quad, last_cubic = (qx, qy), None
                x, y = nx, ny
            elif op == "A":
                rx, ry, rot = number(), number(), number()
                large_arc, sweep = number(), number()
                nx, ny = number(), number()
                if relative:
                    nx, ny = x + nx, y + ny
                if not current:
                    current = [(x, y)]
                current.extend(arc_points(x, y, rx, ry, rot, large_arc, sweep, nx, ny, tolerance))
                x, y = nx, ny
                last_cubic = last_quad = None
            else:
                i += 1
        except StopIteration:
            break
    if current:
        subpaths.append(current)
    return [p for p in subpaths if len(p) > 1]


def shape_subpaths(el, tag, tolerance):
    """Flatten one drawable element into subpaths in its own coordinates."""
    def num(name, default=0.0):
        value = length_px(el.get(name))
        return default if value is None else value

    if tag == "path":
        return path_subpaths(el.get("d"), tolerance)
    if tag == "line":
        return [[(num("x1"), num("y1")), (num("x2"), num("y2"))]]
    if tag in ("polyline", "polygon"):
        nums = [float(v) for v in NUMBER.findall(el.get("points") or "")]
        points = list(zip(nums[0::2], nums[1::2]))
        if tag == "polygon" and len(points) > 1:
            points.append(points[0])
        return [points] if len(points) > 1 else []
    if tag == "rect":
        x, y, w, h = num("x"), num("y"), num("width"), num("height")
        if w <= 0 or h <= 0:
            return []
        rx, ry = el.get("rx"), el.get("ry")
        rx = length_px(rx) if rx else None
        ry = length_px(ry) if ry else None
        rx = ry if rx is None else rx
        ry = rx if ry is None else ry
        if not rx or not ry:
            return [[(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]]
        rx, ry = min(rx, w / 2), min(ry, h / 2)
        d = (f"M{x + rx},{y} H{x + w - rx} A{rx},{ry} 0 0 1 {x + w},{y + ry}"
             f" V{y + h - ry} A{rx},{ry} 0 0 1 {x + w - rx},{y + h}"
             f" H{x + rx} A{rx},{ry} 0 0 1 {x},{y + h - ry}"
             f" V{y + ry} A{rx},{ry} 0 0 1 {x + rx},{y} Z")
        return path_subpaths(d, tolerance)
    if tag in ("circle", "ellipse"):
        cx, cy = num("cx"), num("cy")
        if tag == "circle":
            rx = ry = num("r")
        else:
            rx, ry = num("rx"), num("ry")
        if rx <= 0 or ry <= 0:
            return []
        d = (f"M{cx + rx},{cy} A{rx},{ry} 0 0 1 {cx},{cy + ry} A{rx},{ry} 0 0 1 {cx - rx},{cy}"
             f" A{rx},{ry} 0 0 1 {cx},{cy - ry} A{rx},{ry} 0 0 1 {cx + rx},{cy} Z")
        return path_subpaths(d, tolerance)
    return []


class Drawing:
    """A flattened SVG: the polylines to draw, in inches from the page's top-left, and the page."""

    def __init__(self, paths, width_in, height_in):
        self.paths = paths                  # [[(x_in, y_in), ...], ...]
        self.width_in = width_in
        self.height_in = height_in


def page_size_in(root):
    """The page size in inches, from width/height, falling back to the viewBox at 96 per inch."""
    view_box = root.get("viewBox")
    box = [float(v) for v in re.split(r"[\s,]+", view_box.strip())] if view_box else None
    width = length_px(root.get("width"), box[2] if box else None)
    height = length_px(root.get("height"), box[3] if box else None)
    if width is None or height is None:
        if not box:
            return None
        width, height = box[2], box[3]
    return width / 96.0, height / 96.0


def flatten(root, tolerance_in=CURVE_TOLERANCE_IN):
    """Flatten an SVG element tree into a Drawing, or None when it has no size to plot at."""
    size = page_size_in(root)
    if size is None:
        return None
    width_in, height_in = size
    view_box = root.get("viewBox")
    box = [float(v) for v in re.split(r"[\s,]+", view_box.strip())] if view_box else None
    # User units -> inches. With a viewBox the artwork is stretched to fill the page.
    if box and box[2] and box[3]:
        scale_x, scale_y = width_in / box[2], height_in / box[3]
        base = multiply((scale_x, 0, 0, scale_y, 0, 0), (1, 0, 0, 1, -box[0], -box[1]))
    else:
        scale_x = scale_y = 1 / 96.0
        base = (scale_x, 0, 0, scale_y, 0, 0)
    # Curve tolerance is asked for in inches but applied in user units.
    tolerance = tolerance_in / max(1e-9, (abs(scale_x) + abs(scale_y)) / 2)

    paths = []

    def walk(el, matrix):
        for child in el:
            tag = child.tag
            if not isinstance(tag, str) or not tag.startswith(SVG_NS):
                continue
            tag = tag[len(SVG_NS):]
            if tag in ("defs", "metadata", "title", "desc", "style", "script", "clipPath", "mask",
                       "symbol", "marker", "pattern", "filter"):
                continue
            if hidden(child):
                continue
            here = multiply(matrix, parse_transform(child.get("transform")))
            if tag in ("g", "a", "switch", "svg"):
                walk(child, here)
                continue
            for points in shape_subpaths(child, tag, tolerance):
                placed = [apply(here, px, py) for px, py in points]
                if len(placed) > 1:
                    paths.append(placed)

    walk(root, base)
    return Drawing(paths, width_in, height_in)


def polyline_length(points):
    return sum(math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
               for i in range(len(points) - 1))
