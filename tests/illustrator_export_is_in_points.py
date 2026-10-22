#!/usr/bin/env python3
"""
Illustrator counts in points, 72 to the inch, whichever way it writes SVG. Save As marks the file with
a "Generator: Adobe Illustrator" comment; Export As doesn't, and with Responsive on writes no page size
either - but still names things in data-name and styles them .cls-1. Either way the drawing is the
size it was in Illustrator, not three quarters of it.

Runs on its own:   python3 tests/illustrator_export_is_in_points.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

failures = []


def check(what, got, want):
    if got == want:
        print(f"  ok    {what}")
    else:
        failures.append(what)
        print(f"  FAIL  {what}\n          wanted {want!r}\n          got    {got!r}")


def size_of(svg):
    from lxml import etree
    root = etree.fromstring(svg.encode("utf-8"))
    server.normalize_size(root)
    return root.get("width"), root.get("height")


def main():
    body = '<path d="M0 0 L1980 0 L1980 1404 L0 1404 Z"/>'
    print("a 27.5 x 19.5 in artboard, 1980 x 1404 points")
    check("saved as SVG, with the comment", size_of(
        '<?xml version="1.0"?><!-- Generator: Adobe Illustrator 28.0.0 -->'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1980 1404">{body}</svg>'), ("27.5in", "19.5in"))
    check("exported, layers in data-name", size_of(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1980 1404"><g id="Layer_1" data-name="Layer 1">{body}</g></svg>'),
        ("27.5in", "19.5in"))
    check("exported, styles as .cls-1", size_of(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1980 1404"><defs><style>.cls-1{fill:#dd3127}</style></defs>'
        f'{body}</svg>'), ("27.5in", "19.5in"))
    check("exported with a size in px, which are its points", size_of(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="1980" height="1404"><g data-name="Layer 1">{body}</g></svg>'),
        ("27.5in", "19.5in"))
    print("\nanyone else's, 96 to the inch")
    check("no page size, no sign of Illustrator", size_of(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1980 1404"><g id="Layer_1">{body}</g></svg>'),
        ("20.625in", "14.625in"))

    print(f"\n{'all good' if not failures else f'{len(failures)} failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
