#!/usr/bin/env python3
"""
Two saves landing at the same moment both finish, and the file is one of them whole.

Every write of a file this app keeps went through a temp file named after its target and nothing
else - jobs/current.tmp. Two pages auto-saving the open drawing at the same moment both wrote it,
the first rename carried it off, and the second died inside the request:

    FileNotFoundError: ... jobs/current.tmp -> jobs/current.svg

That save was lost and the page got a 500 (Tom, 2026-11-24). places.write_atomic settles each write's
temp name in the one step that can't race. This leans on it hard, and checks what the rename is for:
a reader never sees half a file.

Run it from the repository:   python3 tests/two_saves_at_once_dont_collide.py
It needs nothing running. It works in a temporary folder of its own.
"""
import importlib.util
import os
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("srv", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
places = server.places

WRITERS = 24
ROUNDS = 12

failures = []


def check(what, ok):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


def leftovers(folder):
    return [p.name for p in folder.iterdir() if p.name.endswith(".tmp")]


def main():
    folder = Path(tempfile.mkdtemp())
    target = folder / "current.svg"

    # Every writer says who it is, at a length of its own: half of one inside another would show.
    bodies = [(f"<svg id='{n}'>" + f"{n:04d}" * (n + 1) * 40 + "</svg>").encode() for n in range(WRITERS)]
    seen = []
    trouble = []
    start = threading.Barrier(WRITERS)

    def writer(n):
        try:
            start.wait()
            for _ in range(ROUNDS):
                places.write_atomic(target, bodies[n])
                seen.append(target.read_bytes())
        except Exception as exc:  # noqa: BLE001 - what this test is about
            trouble.append(f"{type(exc).__name__}: {exc}")

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(WRITERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    check(f"{WRITERS} writers, {ROUNDS} saves each, none of them failed", not trouble)
    if trouble:
        print("        " + trouble[0])
    check("every read saw one writer's file, whole", all(b in bodies for b in seen))
    check("the file left behind is one of them", target.read_bytes() in bodies)
    check("no temp files are left beside it", not leftovers(folder))

    # The permissions of a file that already has its own are kept; a new file is readable as usual.
    kept = folder / "presets.json"
    kept.write_text("{}")
    os.chmod(kept, 0o600)
    places.write_atomic(kept, '{"a": 1}')
    check("a write over a file keeps its permissions", kept.stat().st_mode & 0o777 == 0o600)
    check("and its contents are the new ones", kept.read_text() == '{"a": 1}')
    fresh = folder / "new.json"
    places.write_atomic(fresh, "{}")
    check("a file written for the first time is readable, not private to mkstemp",
          fresh.stat().st_mode & 0o777 == 0o644)

    # A write that fails partway leaves the old file alone and nothing lying beside it.
    before = target.read_bytes()
    try:
        places.write_atomic(target, 17)  # not bytes, not text
    except Exception:  # noqa: BLE001 - expected
        pass
    check("a write that fails leaves the file as it was", target.read_bytes() == before)
    check("and clears up after itself", not leftovers(folder))

    print("\nall passed" if not failures else f"\n{len(failures)} failed")
    sys.exit(1 if failures else 0)


main()
