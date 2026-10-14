#!/usr/bin/env python3
"""
The printer profiles Image can split a photo by are listed, and nothing it can't use.

Image splits a photo into a profile's inks itself (web/src/shared/lib/drawing/icc.ts), so the list
(server.py, color_profiles) must hold only what that code reads: printer profiles from Lab with a
lookup-table photo-to-ink conversion, of any number of inks - and never a display or RGB profile.
The file itself is sent only for a listed profile.

Run it from the repository:   python3 tests/color_profiles_are_listed.py
It needs nothing running. It reads the Mac's own ColorSync folders.
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

failures = []


def check(what, ok):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


listed = server.color_profiles()
generic = Path("/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc")
if generic.exists():
    check("Generic CMYK is listed, with four inks", any(p["path"] == str(generic) and p["inks"] == 4 for p in listed))
check("no RGB or display profile is", server.profile_info(Path("/System/Library/ColorSync/Profiles/sRGB Profile.icc")) is None)
check("each listed once", len({p["path"] for p in listed}) == len(listed))
client = server.app.test_client()
check("a listed profile's file is sent", not listed or client.get("/api/color-profile", query_string={"path": listed[0]["path"]}).status_code == 200)
check("anything else isn't", client.get("/api/color-profile", query_string={"path": "/etc/hosts"}).status_code == 404)

print()
print(f"{len(failures)} failed" if failures else "All good.")
sys.exit(1 if failures else 0)
