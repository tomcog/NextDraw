#!/usr/bin/env python3
"""
A save only writes over a file when it is the drawing's own file. Anything else that lands on a name
already taken is numbered instead.

Before, a new drawing from Image - named after its picture - silently replaced an earlier drawing
made from a picture with the same name, and two unnamed Studio drawings both became Untitled.svg.

Runs on its own, against a temporary folder:   python3 tests/saving_never_replaces_another_drawing.py
"""

import sys
import tempfile
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


def drawing(mark):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="11in" height="8.5in" viewBox="0 0 11 8.5">'
        f'<path id="{mark}" d="M 1 1 L 2 2" stroke="#000"/></svg>'
    )


def main():
    folder = Path(tempfile.mkdtemp())
    server.DRAWINGS_FOLDER = folder
    client = server.app.test_client()

    print("a new drawing on a name that's taken")
    first = client.post("/api/studio/save", json={"name": "portrait", "svg": drawing("first")}).get_json()
    check("the first is saved under its name", first.get("name"), "portrait.svg")
    second = client.post("/api/studio/save", json={"name": "portrait", "svg": drawing("second")}).get_json()
    check("the second is numbered", second.get("name"), "portrait 2.svg")
    third = client.post("/api/studio/save", json={"name": "portrait", "svg": drawing("third")}).get_json()
    check("and the third after it", third.get("name"), "portrait 3.svg")
    check("the first file still holds the first drawing", 'id="first"' in (folder / "portrait.svg").read_text(), True)

    print("\nsaving back into its own file")
    again = client.post("/api/studio/save", json={"name": "portrait", "replace": True, "svg": drawing("edited")}).get_json()
    check("it keeps its name", again.get("name"), "portrait.svg")
    check("and the file holds the edit", 'id="edited"' in (folder / "portrait.svg").read_text(), True)

    print(f"\n{'all good' if not failures else f'{len(failures)} failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
