#!/usr/bin/env python3
"""
Image splits a photo by the printer profiles in NextDraw's own Color profiles folder, and no others.

Image applies a profile itself (web/src/shared/lib/drawing/icc.ts), so the list (server.py,
color_profiles) must hold only what that code reads - printer profiles from Lab with a lookup-table
photo-to-ink conversion, of any number of inks - and only from the folder, not every profile on the
Mac. A profile's file is sent by its name in the folder; a drawing from before the folder, which kept
the whole path, gets the file of that name; nothing outside the folder is ever sent.

Run it from the repository:   python3 tests/color_profiles_are_listed.py
It needs nothing running. It works in a temporary folder, copying in two of macOS's own profiles.
"""
import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

SYSTEM = Path("/System/Library/ColorSync/Profiles")
failures = []


def check(what, ok):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


with tempfile.TemporaryDirectory() as tmp:
    server.COLOR_PROFILES = Path(tmp) / "Color profiles"
    client = server.app.test_client()
    check("no folder yet: nothing listed", client.get("/api/color-profiles").get_json()["profiles"] == [])
    server.COLOR_PROFILES.mkdir()
    shutil.copy(SYSTEM / "Generic CMYK Profile.icc", server.COLOR_PROFILES)
    shutil.copy(SYSTEM / "sRGB Profile.icc", server.COLOR_PROFILES)
    listed = client.get("/api/color-profiles").get_json()["profiles"]
    check("the CMYK profile is listed, with four inks", [(p["file"], p["inks"]) for p in listed] == [("Generic CMYK Profile.icc", 4)])
    check("the RGB one in the folder isn't", all(p["file"] != "sRGB Profile.icc" for p in listed))
    get = lambda **q: client.get("/api/color-profile", query_string=q)
    check("a listed profile is sent by its name", get(name="Generic CMYK Profile.icc").status_code == 200)
    check("and by an old drawing's whole path", get(path="/Users/someone/Library/ColorSync/Profiles/Generic CMYK Profile.icc").status_code == 200)
    check("one that isn't listed isn't", get(name="sRGB Profile.icc").status_code == 404)
    check("nor anything outside the folder", get(name="../../etc/hosts").status_code == 404)

print()
print(f"{len(failures)} failed" if failures else "All good.")
sys.exit(1 if failures else 0)
