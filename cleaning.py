"""What a request is allowed to say: every number, flag and block that arrives from a page, read
into something safe to act on (Tom, 2026-11-24).

A page can send anything - it is a page - so nothing here trusts what it is given: a value outside
its range is clamped, a value of the wrong kind is dropped, and what is left is what the plotter and
the drawing are asked to do. Keeping it in one file is what makes that promise checkable.
"""
from nextdraw import NextDraw
from plotextras import HEX_COLOR, clean_blocks, clean_signature, clean_trim
from svgpaths import mm

# Settings the GUI may change, with (min, max) limits from the NextDraw docs.
NUMERIC_SETTINGS = {
    "model": (1, 10),
    "handling": (1, 4),
    "speed_pendown": (1, 100),
    "speed_penup": (1, 100),
    "accel": (1, 100),
    "pen_pos_down": (0, 100),
    "pen_pos_up": (0, 100),
    "pen_setup": (0, 100),  # App-only: holder height for mounting a pen with the sizing block
    "pen_rate_lower": (1, 100),
    "pen_rate_raise": (1, 100),
    "copies": (1, 100),
    "page_delay": (0, 3600),
    "reordering": (0, 4),
}

BOOL_SETTINGS = {"auto_rotate", "random_start", "hiding", "drag_only", "ink_builds", "ink_opaque"}

# App-only settings with fractional values: the pen's line width in mm, for drawing the preview.
# join_gap is the NextDraw software's own path joining: two path ends closer than this are drawn as
# one stroke instead of two, saving the lift between them. It is kept in mm like every other length
# the operator sees, and handed to the software in inches as params.min_gap (its default is 0.006 in,
# 0.15 mm). Zero joins only ends that meet exactly.
FLOAT_SETTINGS = {"pen_width": (0.05, 10.0), "ink_opacity": (0.05, 1.0), "ink_build": (0.0, 1.0),
                  "join_gap": (0.0, 5.0)}

# What a pen preset remembers (ink_opacity is how much the paper shows through a stroke, and
# ink_builds whether more of the same ink darkens what's already there, and ink_build how much a
# second pass adds when it does, and ink_opaque whether it covers what's under it - paper and other
# inks - instead of blending with them, all for the preview).
# Paper size is chosen separately and isn't part of a preset.
PRESET_NUMERIC = {
    "pen_pos_down", "pen_pos_up", "pen_setup", "pen_rate_lower", "pen_rate_raise",
    "speed_pendown", "speed_penup", "accel", "handling", "pen_width", "ink_opacity", "ink_builds", "ink_opaque",
    "ink_build", "join_gap",
}

def clean_values(raw):
    """Settings from the page, checked and limited, before any plotter is considered: what a preset stores."""
    settings = {}
    for key, (low, high) in NUMERIC_SETTINGS.items():
        if key in raw:
            try:
                settings[key] = max(low, min(high, int(float(raw[key]))))
            except (TypeError, ValueError):
                pass
    for key, (low, high) in FLOAT_SETTINGS.items():
        if key in raw:
            try:
                settings[key] = round(max(low, min(high, float(raw[key]))), 3)
            except (TypeError, ValueError):
                pass
    for key in BOOL_SETTINGS:
        if key in raw:
            settings[key] = bool(raw[key])
    # Drawings plot in the orientation they were drawn; the operator turns them with the rotate
    # buttons. NextDraw's own automatic sideways turn is always off.
    settings["auto_rotate"] = False
    return settings

def clean_scale(raw):
    """Drawing scale in percent (1-1000), default 100."""
    try:
        return max(1.0, min(1000.0, float(raw.get("scale", 100))))
    except (TypeError, ValueError):
        return 100.0

def clean_layers(raw):
    """The layers to plot, by id: `layers` (a list, for layers linked to print together) or the older
    single `layer`. None plots the whole drawing."""
    ids = raw.get("layers")
    if not isinstance(ids, list):
        ids = [raw.get("layer")]
    ids = list(dict.fromkeys(str(i)[:200] for i in ids if isinstance(i, str) and i))[:500]
    return ids or None

def clean_rotation(raw):
    """Quarter turns clockwise: 0, 90, 180 or 270."""
    try:
        return int(round(float(raw.get("rotation", 0)) / 90)) % 4 * 90
    except (TypeError, ValueError):
        return 0

def clean_hatch(raw):
    """Hatch spacings chosen in Plot, by layer id, in mm on paper."""
    out = {}
    spacings = raw.get("hatch_spacing")
    if isinstance(spacings, dict):
        for k, v in list(spacings.items())[:500]:
            try:
                out[str(k)[:200]] = round(max(0.1, min(20.0, float(v))), 3)
            except (TypeError, ValueError):
                pass
    return out

def clean_skip_tiny(raw):
    """Skip tiny paths: the size in mm on paper below which a path is left out of the plot, or None (off)."""
    try:
        value = raw.get("skip_tiny")
        return None if value is None else round(max(0.05, min(20.0, float(value))), 3)
    except (TypeError, ValueError):
        return None

def clean_preset_settings(raw):
    """A preset describes a pen: its heights, lift and drop speeds, and drawing speeds."""
    return {k: v for k, v in clean_values(raw).items() if k in PRESET_NUMERIC}

def clean_plot(raw):
    """Only the choices the page saves into a drawing, with sane values."""
    out = {}
    placement = raw.get("placement")
    if isinstance(placement, dict):
        try:
            out["placement"] = {k: round(max(-2000.0, min(2000.0, float(placement[k]))), 3) for k in ("x", "y")}
        except (KeyError, TypeError, ValueError):
            pass
    if "scale" in raw:
        out["scale"] = clean_scale(raw)
    if "rotation" in raw:
        out["rotation"] = clean_rotation(raw)
    if isinstance(raw.get("tool"), str):
        out["tool"] = raw["tool"][:40]
    # Small paths: how much to slow the plotter for drawings full of tiny marks (percent), or absent.
    try:
        if raw.get("small_paths") is not None:
            out["small_paths"] = int(max(10, min(90, float(raw["small_paths"]))))
    except (TypeError, ValueError):
        pass
    # Skip tiny paths: the size in mm below which paths are left out of the plot, or absent (off).
    skip_tiny = clean_skip_tiny(raw)
    if skip_tiny is not None:
        out["skip_tiny"] = skip_tiny
    # The order to plot the layers in, bottom first, by layer id. Which ink goes down before which is
    # a decision about the plot - lighter first, so the darks overprint them - not a change to the
    # drawing, so the file's own layer order is left alone and this says what to do with it instead.
    order = raw.get("layer_order")
    if isinstance(order, list):
        ids = [str(x)[:200] for x in order if isinstance(x, str)][:500]
        if ids:
            out["layer_order"] = ids
    # The ink each layer is being plotted in today, by layer id, when it isn't the color the drawing
    # was made with. The operator swaps a pen to see how the drawing looks in it; that's a choice about
    # this plot, not about the artwork, so it lives here and the drawing's own colors stay untouched -
    # which is also what lets it be put back.
    #
    # A pen is recorded as the pen it is - {"tool", "pen"} and the colour it had as a fallback - so
    # that editing the palette moves every layer using it. A bare hex is a colour picked with the
    # system colour picker, and is also what every file written before pens were recorded holds; both
    # are read, so those files keep working.
    inks = raw.get("layer_colors")
    if isinstance(inks, dict):
        picked = {}
        for k, v in inks.items():
            if isinstance(v, str) and HEX_COLOR.match(v):
                picked[str(k)[:200]] = v.lower()
            elif isinstance(v, dict) and isinstance(v.get("tool"), str) and isinstance(v.get("pen"), str):
                pen = {"tool": v["tool"][:40], "pen": v["pen"][:60]}
                if isinstance(v.get("hex"), str) and HEX_COLOR.match(v["hex"]):
                    pen["hex"] = v["hex"].lower()
                picked[str(k)[:200]] = pen
        if picked:
            out["layer_colors"] = dict(list(picked.items())[:500])
    # What Plot calls each layer (by layer id), when that isn't what the drawing calls it: choosing an
    # ink renames the layer to that ink, so the Layers card reads as the list of pens to load. It is
    # kept here, not written onto the layer, because <nds:design> maps Studio's shapes to their layer
    # BY NAME - renaming the layer in the file would leave Studio unable to find what's on it.
    names = raw.get("layer_names")
    if isinstance(names, dict):
        called = {
            str(k)[:200]: v.strip()[:60]
            for k, v in names.items()
            if isinstance(v, str) and v.strip()
        }
        if called:
            out["layer_names"] = dict(list(called.items())[:500])
    # Hatch spacings chosen while plotting, by layer id, in mm: the ink turned out to want its Studio
    # fills closer or further apart. Plot regenerates the fills at this spacing when it plots; the
    # drawing's own fills, and the spacing Studio gave them, are left as they are.
    hatch = clean_hatch(raw)
    if hatch:
        out["hatch_spacing"] = hatch
    # Layers linked to print together (groups of layer ids): layers going down in the same pen, plotted
    # in one pass instead of one after another with the same pen reloaded. A decision about the plot,
    # like the inks above, so it lives here.
    links = raw.get("layer_links")
    if isinstance(links, list):
        groups = []
        for group in links[:250]:
            if isinstance(group, list):
                ids = list(dict.fromkeys(str(x)[:200] for x in group if isinstance(x, str)))[:500]
                if len(ids) > 1:
                    groups.append(ids)
        if groups:
            out["layer_links"] = groups
    # Which layers Plot is holding back (by layer id). Kept here rather than as a hidden attribute on
    # the layer itself: hiding a layer is Plot deciding what to draw today, not a change to the
    # drawing, so it goes in Plot's own block where Studio will never see it.
    hidden = raw.get("hidden_layers")
    if isinstance(hidden, list):
        out["hidden_layers"] = [str(x)[:200] for x in hidden if isinstance(x, str)][:500]
    # A second drawing tool for mixed-media drawings, and which layers use it (by layer id).
    if isinstance(raw.get("second_tool"), str) and raw["second_tool"]:
        out["second_tool"] = raw["second_tool"][:40]
        layers = raw.get("second_tool_layers")
        if isinstance(layers, list):
            out["second_tool_layers"] = [str(x)[:200] for x in layers if isinstance(x, str)][:500]
    for key, cleaned in (("trim", clean_trim(raw.get("trim"))),
                         ("blocks", clean_blocks(raw.get("blocks"))),
                         ("signature", clean_signature(raw.get("signature")))):
        if cleaned:
            out[key] = cleaned
    paper = raw.get("paper")
    if isinstance(paper, dict):
        cleaned = {}
        for key in ("paper_w", "paper_h", "paper_x", "paper_y"):
            try:
                cleaned[key] = max(0.0, min(2000.0, float(paper[key])))
            except (KeyError, TypeError, ValueError):
                pass
        if isinstance(paper.get("paper_size"), str):
            cleaned["paper_size"] = paper["paper_size"][:40]
        if isinstance(paper.get("paper_color"), str) and HEX_COLOR.match(paper["paper_color"]):
            cleaned["paper_color"] = paper["paper_color"].lower()
        out["paper"] = cleaned
    return out
