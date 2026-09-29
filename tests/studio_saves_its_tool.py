#!/usr/bin/env python3
"""
Saving over a drawing from Studio keeps what Plot chose for it - except the drawing tool, which is
chosen in both apps and so goes with whichever saved last.

Before, the server kept Plot's block whole, tool and all, so a tool picked in Studio was dropped
without a word. Everything else Plot wrote (placement, scale, inks) must still survive.

Runs on its own, against a temporary folder:   python3 tests/studio_saves_its_tool.py
"""

import json
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


def drawing(plot):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:nds="https://github.com/tomcog/NextDraw" '
        'width="11in" height="8.5in" viewBox="0 0 11 8.5">'
        f'<metadata id="nextdraw-plot"><nds:plot>{json.dumps(plot)}</nds:plot></metadata>'
        '<g id="layer1" inkscape:label="1-Black" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
        'inkscape:groupmode="layer"><path d="M 1 1 L 2 2" stroke="#000"/></g></svg>'
    )


def main():
    folder = Path(tempfile.mkdtemp())
    server.DRAWINGS_FOLDER = folder
    client = server.app.test_client()
    path = folder / "tool test.svg"

    # What Plot left in the file: its placement, scale and inks, for the Flair.
    path.write_text(drawing({
        "placement": {"x": 12.5, "y": 3.0}, "scale": 75.0, "rotation": 0,
        "tool": "Paper-Mate Flair Medium",
        "layer_colors": {"layer1": {"tool": "Paper-Mate Flair Medium", "pen": "Black", "hex": "#000000"}},
    }))

    # Studio saves over it, drawn with the Stabilo, with its own fresh defaults for everything else.
    res = client.post("/api/studio/save", json={
        "name": "tool test",
        "svg": drawing({"placement": {"x": 0, "y": 0}, "scale": 100, "rotation": 0, "tool": "Stabilo point 88"}),
    })
    check("the save went through", res.status_code, 200)

    from lxml import etree
    plot = server.read_plot(etree.parse(str(path)).getroot()) or {}
    print("\nwhat the file says now")
    check("the tool is the one Studio saved with", plot.get("tool"), "Stabilo point 88")
    check("Plot's placement is kept", plot.get("placement"), {"x": 12.5, "y": 3.0})
    check("Plot's scale is kept", plot.get("scale"), 75.0)
    check("Plot's inks are kept", sorted(plot.get("layer_colors", {})), ["layer1"])

    print(f"\n{'all good' if not failures else f'{len(failures)} failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
