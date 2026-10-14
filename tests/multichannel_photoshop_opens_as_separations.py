#!/usr/bin/env python3
"""
A Multichannel Photoshop file opens in Image as separations: a grayscale picture per channel.

Separations sometimes arrive as one Photoshop file in Multichannel mode - Cyan, Magenta, Yellow,
Black, Orange, Green, Violet, each a channel - rather than a file per ink. macOS's converter can't
read those at all, so the server reads them itself (server.py, psd_channels). What has to hold:

- Every channel comes back, in order, with the name Photoshop gave it and the color of its ink.
- Each is the channel's own pixels, row for row - packed (RLE) or not, PSD or the large-document
  PSB, 8 or 16 bits - so the plates still register when they're stacked.
- Any other Photoshop file - RGB, CMYK - is left alone (None), to be flattened as before.

Run it from the repository:   python3 tests/multichannel_photoshop_opens_as_separations.py
It needs nothing running: no server, no plotter.
"""
import importlib.util
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

W, H = 5, 3
INKS = [  # name, Lab as Photoshop keeps it (L 0-10000, a and b signed hundredths), roughly the hex
    ("Cyan", (6000, -3800, -5200), "#00a"),
    ("Orange", (7372, 5300, 7900), "#f"),
    ("Spot Color 3", (5000, 0, 0), "#777777"),
]


def plane(c, depth):
    """Channel c's pixels: a gradient of its own, so a mix-up between channels or rows shows."""
    values = [(c * 70 + y * 30 + (x // 2) * 9) % 256 for y in range(H) for x in range(W)]  # pairs, for runs
    return bytes(values) if depth == 8 else b"".join(bytes([v, 0x5A]) for v in values)


def pack_row(row):
    """A row as PackBits: its first two bytes as a repeat run when they're the same, then the rest
    literal, to exercise both."""
    if row[0] != row[1]:
        return bytes([len(row) - 1]) + row
    return bytes([257 - 2, row[0], len(row) - 3]) + row[2:]


def photoshop(mode=7, version=1, rle=True, depth=8):
    big = version == 2
    count = len(INKS)
    head = b"8BPS" + struct.pack(">H", version) + b"\0" * 6 + struct.pack(">HIIHH", count, H, W, depth, mode)
    names = b"".join(struct.pack(">I", len(n) + 1) + (n + "\0").encode("utf-16-be") for n, _, _ in INKS)
    display = struct.pack(">I", 1) + b"".join(
        struct.pack(">HHHHHHB", 7, L, a & 0xFFFF, b & 0xFFFF, 0, 0, 2) for _, (L, a, b), _ in INKS)
    resources = b""
    for rid, block in ((1045, names), (1077, display)):
        resources += b"8BIM" + struct.pack(">H", rid) + b"\0\0" + struct.pack(">I", len(block)) + block + b"\0" * (len(block) % 2)
    body = head + struct.pack(">I", 0) + struct.pack(">I", len(resources)) + resources
    body += (struct.pack(">Q", 0) if big else struct.pack(">I", 0))
    row = W * depth // 8
    planes = [plane(c, depth) for c in range(count)]
    if not rle:
        return body + struct.pack(">H", 0) + b"".join(planes)
    rows = [pack_row(p[y * row:(y + 1) * row]) for p in planes for y in range(H)]
    lengths = b"".join(struct.pack(">I" if big else ">H", len(r)) for r in rows)
    return body + struct.pack(">H", 1) + lengths + b"".join(rows)


def pixels(png):
    """A grayscale PNG's pixels, its filter bytes dropped (gray_png writes filter 0 on every row)."""
    at, data = 8, b""
    while at < len(png):
        n, = struct.unpack(">I", png[at:at + 4])
        if png[at + 4:at + 8] == b"IDAT":
            data += png[at + 8:at + 8 + n]
        at += 12 + n
    raw = zlib.decompress(data)
    return b"".join(raw[y * (W + 1) + 1:(y + 1) * (W + 1)] for y in range(H))


failures = []


def check(what, ok):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


for label, kwargs in (("PSD, packed", {}), ("PSD, raw", {"rle": False}), ("PSB, packed", {"version": 2}),
                      ("PSB, raw", {"version": 2, "rle": False}), ("PSD, 16 bits", {"depth": 16})):
    got = server.psd_channels(photoshop(**kwargs))
    check(f"{label}: every channel, in order, by name",
          got is not None and [c["name"] for c in got] == [n for n, _, _ in INKS])
    if not got:
        continue
    want = [plane(c, 8) if kwargs.get("depth", 8) == 8 else plane(c, 16)[::2] for c in range(len(INKS))]
    check(f"{label}: each channel's own pixels", [pixels(c["png"]) for c in got] == want)
    check(f"{label}: each ink's color", all(c["color"] and c["color"].startswith(hex_) for c, (_, _, hex_) in zip(got, INKS)))

check("an RGB Photoshop file is left to the converter", server.psd_channels(photoshop(mode=3)) is None)
check("a CMYK one too", server.psd_channels(photoshop(mode=4)) is None)
check("and anything not Photoshop's", server.psd_channels(b"\x89PNG\r\n\x1a\n" + b"\0" * 40) is None)
check("Lab white is white", server.lab_hex(100, 0, 0) == "#ffffff")
check("Lab black is black", server.lab_hex(0, 0, 0) == "#000000")

print()
print(f"{len(failures)} failed" if failures else "All good.")
sys.exit(1 if failures else 0)
