"""Path and hatch geometry: a path's data walked out into points, lines across a shape, and the
runs they make. Plain maths over numbers and strings - no SVG tree, no Flask, no state - so it can be
read, and tested, without the server around it (Tom, 2026-11-24).

server.py imports these, so `server.flatten_path_data` and the rest still answer as they did.
"""
import math
import re

def inset_box(box, by):
    """insetBox: a box brought in by the same distance on every side, never past its own middle."""
    x0, y0, x1, y1 = box
    if by <= 0:
        return box
    x = min(by, (x1 - x0) / 2)
    y = min(by, (y1 - y0) / 2)
    return (x0 + x, y0 + y, x1 - x, y1 - y)

def inset_outline(outline, box, by):
    """insetOutlines: an outline brought inward the way the concentric rings are."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if by <= 0 or w <= 1e-9 or h <= 1e-9 or not outline:
        return outline
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    kx = max(0.0, (w - 2 * by) / w)
    ky = max(0.0, (h - 2 * by) / h)
    return [(cx + (px - cx) * kx, cy + (py - cy) * ky) for px, py in outline]

def hatch_lines(kind, box, angle, step, outline=None, inset=0, rows=None):
    """hatchLines: the lines across a rect or ellipse box (x0, y0, x1, y1), `step` apart, swept out
    from the middle. Each is (x1, y1, x2, y2), running in the direction of the angle. A "polygon"
    is clipped to `outline` - the shape's own points - rather than to the box around it.
    `inset` brings the region the lines are cut to inward all round, which is what keeps a wave's
    crests inside the shape instead of across its outline.
    Given a list as `rows`, a polygon's lines also put in it, one for each, (row, edge, edge): the row
    the line is on and the outline edge each end crosses - what outline_strokes joins them by."""
    whole = box
    box = inset_box(box, inset)
    outline = inset_outline(outline, whole, inset)
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0 or not step > 0.002:
        return []
    rad = angle * math.pi / 180
    dx, dy = math.cos(rad), math.sin(rad)
    nx, ny = -dy, dx
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    reach = math.hypot(w, h) / 2

    def clip_box(px, py):
        lo, hi = -math.inf, math.inf
        for p, d, mn, mx in ((px, dx, x0, x1), (py, dy, y0, y1)):
            if abs(d) < 1e-12:
                if not mn <= p <= mx:
                    return None
                continue
            a, z = (mn - p) / d, (mx - p) / d
            if a > z:
                a, z = z, a
            lo, hi = max(lo, a), min(hi, z)
        return None if hi <= lo else (px + dx * lo, py + dy * lo, px + dx * hi, py + dy * hi)

    def clip_ellipse(px, py):
        rx, ry = w / 2, h / 2
        ox, oy, ux, uy = (px - cx) / rx, (py - cy) / ry, dx / rx, dy / ry
        a = ux * ux + uy * uy
        b = 2 * (ox * ux + oy * uy)
        c = ox * ox + oy * oy - 1
        disc = b * b - 4 * a * c
        if a <= 0 or disc <= 0:
            return None
        root = math.sqrt(disc)
        lo, hi = (-b - root) / (2 * a), (-b + root) / (2 * a)
        return (px + dx * lo, py + dy * lo, px + dx * hi, py + dy * hi)

    def clip_outline(px, py):
        """Every span of the line that lies inside the outline, counting crossings the even-odd way.
        Each edge is judged by which side of the line its two ends are on, as clipToOutline does:
        judged by how far along the edge the crossing fell, a corner sitting exactly on the line
        could land a hair past one edge and a hair before the next, drop out of both, and lose the
        whole line from the middle of the fill."""
        hits = []
        for e, ((ax, ay), (bx, by)) in enumerate(zip(outline, outline[1:])):
            # How far off the line each end sits; a point exactly on it counts as the far side, so a
            # corner the outline passes through counts once and one it only touches counts twice.
            sa = (ax - px) * nx + (ay - py) * ny
            sb = (bx - px) * nx + (by - py) * ny
            if (sa < 0) == (sb < 0):
                continue  # both ends the same side, edges along the line included
            u = sa / (sa - sb)
            hits.append(((ax + (bx - ax) * u - px) * dx + (ay + (by - ay) * u - py) * dy, e))
        hits.sort(key=lambda h: h[0])
        return [((px + dx * a, py + dy * a, px + dx * b, py + dy * b), (ea, eb))
                for (a, ea), (b, eb) in zip(hits[0::2], hits[1::2])]

    lines = []
    n = math.ceil(reach / step)
    for i in range(-n, n + 1):
        t = i * step
        px, py = cx + nx * t, cy + ny * t
        if kind == "polygon":
            if not outline or len(outline) < 3:
                continue
            for seg, edges in clip_outline(px, py):
                if math.hypot(seg[2] - seg[0], seg[3] - seg[1]) > 1e-6:
                    lines.append(seg)
                    if rows is not None:
                        rows.append((i, *edges))
            continue
        seg = (clip_box if kind == "rect" else clip_ellipse)(px, py)
        if seg and math.hypot(seg[2] - seg[0], seg[3] - seg[1]) > 1e-6:
            lines.append(seg)
    return lines

def waved(seg, wave, swing):
    """waved: a straight span drawn as a wave, a point every few degrees across the line.

    The wave is counted from where the line itself starts rather than from where the shape cuts it,
    the way the dashes are, so every line in a fill crests together and the waves stand in straight
    rows across it.
    """
    x1, y1, x2, y2 = seg
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length < 1e-9 or wave <= 0:
        return [(x1, y1), (x2, y2)]
    ux, uy = dx / length, dy / length
    frm = x1 * ux + y1 * uy
    steps = max(2, min(400, math.ceil((length / wave) * 12)))
    out = []
    for i in range(steps + 1):
        t = (i / steps) * length
        swing_at = swing * math.sin(2 * math.pi * (frm + t) / wave)
        out.append((x1 + ux * t - uy * swing_at, y1 + uy * t + ux * swing_at))
    return out

def dashed(seg, dash, gap):
    """dashed: a straight span broken into strokes, `dash` long and `gap` apart, measured from where
    the line starts rather than from where the shape cuts it - so the dashes stand in straight rows."""
    x1, y1, x2, y2 = seg
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    step = dash + gap
    if length < 1e-9 or dash <= 0 or step <= 0:
        return [seg]
    ux, uy = dx / length, dy / length
    start_at = x1 * ux + y1 * uy
    out = []
    at = -(((start_at % step) + step) % step)
    while at < length - 1e-9 and len(out) < 2000:
        begin, end = max(at, 0.0), min(at + dash, length)
        if end > begin + 1e-9:
            out.append((x1 + ux * begin, y1 + uy * begin, x1 + ux * end, y1 + uy * end))
        at += step
    return out

def concentric_runs(outlines, box, step):
    """concentricRuns: the outline stepped inward, every edge brought in by the same distance."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    runs = []
    for i in range(2000):
        inset = i * step
        kx = (w - 2 * inset) / w if w > 1e-9 else 0
        ky = (h - 2 * inset) / h if h > 1e-9 else 0
        if kx <= 0.01 or ky <= 0.01:
            break
        for outline in outlines:
            runs.append([(cx + (px - cx) * kx, cy + (py - cy) * ky) for px, py in outline])
    return runs

def closed_outlines(kind, box, outline):
    """The outlines a concentric fill steps inward from: a curve's own points, or the box's edges."""
    if kind == "polygon" and outline:
        return [list(outline)]
    x0, y0, x1, y1 = box
    if kind == "rect":
        return [[(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]]
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    steps = 72
    rim = [(cx + rx * math.cos(-math.pi / 2 + 2 * math.pi * i / steps),
            cy + ry * math.sin(-math.pi / 2 + 2 * math.pi * i / steps)) for i in range(steps)]
    return [rim + [rim[0]]]  # closed on the point it started from, exactly

def fill_runs(kind, box, fill, step, outline=None):
    """fillRuns: everything a fill draws, as runs of points - one run per stroke the pen makes."""
    what = fill.get("kind") or "hatch"
    inches = lambda mm: float(mm) / 25.4 / (float(fill.get("scale") or 100) / 100)  # noqa: E731
    if what == "concentric":
        return concentric_runs(closed_outlines(kind, box, outline), box, step)
    angle = float(fill.get("angle") or 0)
    if what == "wavy":
        wave = inches(fill.get("wave_mm", 6))
        # Kept in step with defaultSwingMm in hatch.ts: a swing nobody set is a fraction of the
        # spacing, so the waves stay between their neighbours whatever pen the spacing came from.
        # Taken from `step` rather than from the fill's own spacing because that is the spacing the
        # lines are actually being drawn at - the tool's, when Plot is regenerating at its own.
        swing = (inches(fill["swing_mm"]) if fill.get("swing_mm") is not None
                 else inches(round(step * 25.4 * float(fill.get("scale") or 100) / 100 * 0.4, 2)))
        # Cut to a shape brought in by the swing, so the crests land on the outline, not across it.
        return [waved(seg, wave, swing) for seg in hatch_lines(kind, box, angle, step, outline, swing)]
    rows = []
    lines = hatch_lines(kind, box, angle, step, outline, rows=rows)
    if what == "dashes":
        dash = inches(fill.get("dash_mm", 3))
        gap = inches(fill.get("gap_mm", 2))
        return [[(d[0], d[1]), (d[2], d[3])] for seg in lines for d in dashed(seg, dash, gap)]
    if fill.get("connected"):
        if kind == "polygon":
            return outline_strokes(box, angle, step, lines, rows, outline)
        stroke = hatch_stroke(kind, box, lines, outline)
        return [stroke] if len(stroke) > 1 else []
    return [[(x1, y1), (x2, y2)] for x1, y1, x2, y2 in lines]

def hatch_stroke(kind, box, lines, outline=None):
    """hatchStroke: a rect's or ellipse's lines as one zigzag, each end joined to the next line's
    start along the shape's edge - by the corner of a rect, along the curve of an ellipse. A list of
    (x, y). A polygon is joined by outline_strokes."""
    x0, y0, x1, y1 = box
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    eps = 1e-6

    def join(a, b):
        if kind == "rect":
            side = lambda p: x0 if abs(p[0] - x0) < eps else x1 if abs(p[0] - x1) < eps else None  # noqa: E731
            cap = lambda p: y0 if abs(p[1] - y0) < eps else y1 if abs(p[1] - y1) < eps else None  # noqa: E731
            sf, cf, st, ct = side(a), cap(a), side(b), cap(b)
            if sf is not None and ct is not None and sf != st and cf != ct:
                return [(sf, ct)]
            if cf is not None and st is not None and cf != ct and sf != st:
                return [(st, cf)]
            return []
        a0 = math.atan2((a[1] - cy) / ry, (a[0] - cx) / rx)
        a1 = math.atan2((b[1] - cy) / ry, (b[0] - cx) / rx)
        if a1 - a0 > math.pi:
            a1 -= 2 * math.pi
        if a0 - a1 > math.pi:
            a1 += 2 * math.pi
        n = int(abs(a1 - a0) // (math.pi / 60))
        return [(cx + rx * math.cos(a0 + (a1 - a0) * (k + 1) / (n + 1)),
                 cy + ry * math.sin(a0 + (a1 - a0) * (k + 1) / (n + 1))) for k in range(n)]

    points = []
    for i, (ax, ay, bx, by) in enumerate(lines):
        start, end = ((ax, ay), (bx, by)) if i % 2 == 0 else ((bx, by), (ax, ay))
        if points:
            points.extend(join(points[-1], start))
        points += [start, end]
    return points

def outline_strokes(box, angle, step, lines, rows, outline):
    """outlineStrokes: a polygon's lines in as few strokes as its outline allows. An end joins a line
    on the next row only where the outline runs between them without leaving the strip between the
    two rows; anywhere else the pen lifts. A list of runs of (x, y)."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rad = angle * math.pi / 180
    nx, ny = -math.sin(rad), math.cos(rad)
    eps = 1e-9
    n = len(outline) - 1  # the last point repeats the first

    def along(frm, to, way, lo, hi):
        count = (to - frm + n) % n if way == 1 else (frm - to + n) % n
        out = []
        for k in range(count):
            p = outline[(frm + 1 + k) % n if way == 1 else (frm - k + n) % n]
            across = (p[0] - cx) * nx + (p[1] - cy) * ny
            if across < lo - eps or across > hi + eps:
                return None
            out.append(p)
        return out

    def walk(frm, to, row):
        lo, hi = row * step, (row + 1) * step
        fwd, back = along(frm, to, 1, lo, hi), along(frm, to, -1, lo, hi)
        if fwd is not None and back is not None:
            return fwd if len(fwd) <= len(back) else back
        return fwd if fwd is not None else back

    by_row = {}
    for k, (row, _, _) in enumerate(rows):
        by_row.setdefault(row, []).append(k)
    used = set()
    strokes = []
    for first in range(len(lines)):
        if first in used:
            continue
        used.add(first)
        ax, ay, bx, by = lines[first]
        stroke = [(ax, ay), (bx, by)]
        row, exit_edge = rows[first][0], rows[first][2]
        while True:
            nxt = None
            for k in by_row.get(row + 1, []):
                if k in used:
                    continue
                for end in (0, 1):
                    path = walk(exit_edge, rows[k][1 + end], row)
                    if path is not None:
                        nxt = (k, end, path)
                        break
                if nxt:
                    break
            if not nxt:
                break
            k, end, path = nxt
            used.add(k)
            sx, sy, ex, ey = lines[k]
            ends = [(sx, sy), (ex, ey)]
            stroke += path + [ends[end], ends[1 - end]]
            exit_edge = rows[k][2 - end]
            row += 1
        strokes.append(stroke)
    return strokes

# Reading path data, as web/src/shared/lib/drawing/path.ts reads it - a port, kept in step by
# tests/plot_walks_a_path_out_as_studio_does.py. Studio keeps a curve as the curve, and writes it back
# as one; to hatch a curved shape here the curve is walked out into points at the same step Studio
# walks it at, so the outline Plot clips to is the outline Studio clipped to.
PATH_TOKENS = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?", re.I)

PATH_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}

def cubic_points(fr, c1, c2, to, step):
    """cubic: a cubic walked in pieces of about `step`, the first point left to whatever drew it."""
    rough = (math.hypot(c1[0] - fr[0], c1[1] - fr[1]) + math.hypot(c2[0] - c1[0], c2[1] - c1[1])
             + math.hypot(to[0] - c2[0], to[1] - c2[1]))
    steps = max(2, min(200, math.ceil(rough / step)))
    out = []
    for i in range(steps):
        t = (i + 1) / steps
        u = 1 - t
        out.append((u * u * u * fr[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
                    u * u * u * fr[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1]))
    return out

def arc_points(fr, rx, ry, deg, large, sweep, to, step):
    """arc: an elliptical arc as the format describes it, walked out at about `step`."""
    if not rx or not ry:
        return [to]
    rad = deg * math.pi / 180
    cos, sin = math.cos(rad), math.sin(rad)
    dx, dy = (fr[0] - to[0]) / 2, (fr[1] - to[1]) / 2
    x1 = cos * dx + sin * dy
    y1 = -sin * dx + cos * dy
    ax, ay = abs(rx), abs(ry)
    big = (x1 * x1) / (ax * ax) + (y1 * y1) / (ay * ay)
    if big > 1:
        ax *= math.sqrt(big)
        ay *= math.sqrt(big)
    denom = ax * ax * y1 * y1 + ay * ay * x1 * x1
    factor = math.sqrt(max(0.0, (ax * ax * ay * ay - denom) / denom)) * (-1 if large == sweep else 1)
    cx1 = factor * ax * y1 / ay
    cy1 = -factor * ay * x1 / ax
    cx = cos * cx1 - sin * cy1 + (fr[0] + to[0]) / 2
    cy = sin * cx1 + cos * cy1 + (fr[1] + to[1]) / 2
    start = math.atan2((y1 - cy1) / ay, (x1 - cx1) / ax)
    sweep_angle = math.atan2((-y1 - cy1) / ay, (-x1 - cx1) / ax) - start
    if not sweep and sweep_angle > 0:
        sweep_angle -= 2 * math.pi
    if sweep and sweep_angle < 0:
        sweep_angle += 2 * math.pi
    around = abs(sweep_angle) * max(ax, ay)
    steps = max(2, min(400, math.ceil(around / step)))
    out = []
    for i in range(steps):
        a = start + sweep_angle * (i + 1) / steps
        px, py = ax * math.cos(a), ay * math.sin(a)
        out.append((cos * px - sin * py + cx, sin * px + cos * py + cy))
    return out

def flatten_path_data(d, step=0.01):
    """flattenPath: every run of points a path draws, its curves walked out at about `step`."""
    tokens = PATH_TOKENS.findall(d or "")
    runs, run = [], []
    at = (0.0, 0.0)
    start = (0.0, 0.0)
    last_control = None  # for S and T, which reflect the one before
    state = {"command": "", "numbers": []}

    def flush():
        nonlocal run
        if len(run) > 1:
            runs.append(run)
        run = []

    def apply():
        nonlocal run, at, start, last_control
        command = state["command"]
        upper = command.upper()
        rel = command != upper
        take = PATH_ARITY.get(upper, 0)
        numbers = state["numbers"]
        first = True
        while take == 0 or len(numbers) >= take:
            n = numbers[:take]
            del numbers[:take]
            rx = (lambda v: at[0] + v) if rel else (lambda v: v)
            ry = (lambda v: at[1] + v) if rel else (lambda v: v)
            if upper == "M":
                to = (rx(n[0]), ry(n[1]))
                if first:
                    flush()
                    start = to
                    run = [to]
                else:
                    run.append(to)
                at = to
                last_control = None
            elif upper == "L":
                at = (rx(n[0]), ry(n[1]))
                run.append(at)
                last_control = None
            elif upper == "H":
                at = (rx(n[0]), at[1])
                run.append(at)
                last_control = None
            elif upper == "V":
                at = (at[0], ry(n[0]))
                run.append(at)
                last_control = None
            elif upper in ("C", "S"):
                if upper == "C":
                    c1 = (rx(n[0]), ry(n[1]))
                elif last_control:
                    c1 = (2 * at[0] - last_control[0], 2 * at[1] - last_control[1])
                else:
                    c1 = at
                c2 = (rx(n[2]), ry(n[3])) if upper == "C" else (rx(n[0]), ry(n[1]))
                to = (rx(n[4]), ry(n[5])) if upper == "C" else (rx(n[2]), ry(n[3]))
                run.extend(cubic_points(at, c1, c2, to, step))
                last_control = c2
                at = to
            elif upper in ("Q", "T"):
                if upper == "Q":
                    q = (rx(n[0]), ry(n[1]))
                elif last_control:
                    q = (2 * at[0] - last_control[0], 2 * at[1] - last_control[1])
                else:
                    q = at
                to = (rx(n[2]), ry(n[3])) if upper == "Q" else (rx(n[0]), ry(n[1]))
                c1 = (at[0] + (2 / 3) * (q[0] - at[0]), at[1] + (2 / 3) * (q[1] - at[1]))
                c2 = (to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1]))
                run.extend(cubic_points(at, c1, c2, to, step))
                last_control = q
                at = to
            elif upper == "A":
                to = (rx(n[5]), ry(n[6]))
                run.extend(arc_points(at, n[0], n[1], n[2], n[3], n[4], to, step))
                last_control = None
                at = to
            elif upper == "Z":
                run.append(start)
                flush()
                run = [start]
                at = start
                last_control = None
            first = False
            if take == 0:
                break
        state["numbers"] = []
        # A move's later pairs arrive one at a time; they are lines from here on, not new moves.
        if upper == "M":
            state["command"] = "l" if rel else "L"

    for token in tokens:
        if PATH_ARITY.get(token.upper()) is not None and len(token) == 1 and token.isalpha():
            if state["command"]:
                apply()
            state["command"] = token
            if token.upper() == "Z":
                apply()
                state["command"] = ""  # done once; applied again it leaves a zero-length run
            continue
        state["numbers"].append(float(token))
        if state["command"] and len(state["numbers"]) >= PATH_ARITY.get(state["command"].upper(), 0):
            apply()
    if state["command"]:
        apply()
    flush()
    return runs

def mm(inches):
    return round(inches * 25.4, 2)

def reshape_matrix(body, bounds):
    """
    The change asked for, in inches on the page, as (a, b, c, d, e, f) - x' = a x + c y + e,
    y' = b x + d y + f - or None. scale: a percent of the drawing's size now, about its middle. turn:
    a quarter turn, 1 to the right or -1 to the left, about its middle; the paper stays as it lies.
    turn_paper: the page and everything on it a quarter turn together, landscape to portrait - its own
    name, so a server from before it refuses it rather than turning the drawing alone.
    fit: as big as the paper allows inside margin_mm - bottom mm at the foot, if given - or fit_margins:
    {top, right, bottom, left} in mm, a side each - placed in the room left over as align says - the paper being box (x, y, width, height in inches on the page), or
    the page.
    bake: Plot's own scale and turn from before, put into the drawing - scaled about the page's
    corner, where Plot scaled it from, and turned about its middle.
    """
    x0, y0, x1, y1, page_w, page_h = bounds
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2

    def about(k, quarter):
        # Scaled by k and turned so many quarters right, about the middle.
        cos, sin = [(1, 0), (0, 1), (-1, 0), (0, -1)][quarter % 4]
        a, b, c, d = k * cos, k * sin, -k * sin, k * cos
        return a, b, c, d, mx - a * mx - c * my, my - b * mx - d * my

    if "scale" in body:
        k = float(body["scale"]) / 100
        return about(k, 0) if 0.001 < k < 100 else None
    if "turn_paper" in body:
        # About the page: a right turn puts its top-left corner top right, the page now page_h wide.
        return (0, 1, -1, 0, page_h, 0) if int(body["turn_paper"]) > 0 else (0, -1, 1, 0, 0, page_w)
    if "turn" in body:
        return about(1, 1 if int(body["turn"]) > 0 else 3)
    if "fit" in body or "fit_margins" in body:
        if isinstance(body.get("fit_margins"), dict):
            side = {k: max(0.0, float(body["fit_margins"].get(k, 0))) / 25.4 for k in ("top", "right", "bottom", "left")}
        else:
            margin = max(0.0, float(body["fit"])) / 25.4
            bottom = max(0.0, float(body["bottom"])) / 25.4 if body.get("bottom") is not None else margin
            side = {"top": margin, "right": margin, "bottom": bottom, "left": margin}
        align = body.get("align") or {}
        ax = min(1.0, max(0.0, float(align.get("x", 0.5))))
        ay = min(1.0, max(0.0, float(align.get("y", 0.5))))
        # The paper, in inches on the page: where Plot has the page placed on it. The page itself if not said.
        bx, by, bw, bh = [float(v) for v in body["box"]] if isinstance(body.get("box"), list) and len(body["box"]) == 4 else (0.0, 0.0, page_w, page_h)
        room_w, room_h = bw - side["left"] - side["right"], bh - side["top"] - side["bottom"]
        dw, dh = x1 - x0, y1 - y0
        if room_w <= 0 or room_h <= 0:
            return None
        k = min(room_w / dw if dw > 1e-9 else float("inf"), room_h / dh if dh > 1e-9 else float("inf"))
        if k == float("inf"):
            return None
        # Its corner goes to the margin plus the alignment's share of the room it doesn't fill.
        return k, 0, 0, k, bx + side["left"] + (room_w - dw * k) * ax - x0 * k, by + side["top"] + (room_h - dh * k) * ay - y0 * k
    if "bake" in body:
        bake = body["bake"] or {}
        k = float(bake.get("scale", 100)) / 100
        quarter = int(round(float(bake.get("rotation", 0)) / 90)) % 4
        # Scaled about the page's corner first, then turned about where the middle went.
        mx, my = mx * k, my * k
        a, b, c, d, e, f = about(1, quarter)
        return a * k, b * k, c * k, d * k, e, f
    return None
