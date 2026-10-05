// A shape made of several paths: saved as a group inside its layer, read back as the same shape, and
// a group from another program's file read as a shape too - one level deep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { buildSvg } from "../src/studio/lib/svg";
import { parseDrawing } from "../src/studio/lib/parse";
import { groupsOf, withWholeGroups, type Layer, type Page, type Shape } from "../src/studio/lib/shapes";

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;

const page: Page = { w: 11, h: 8.5 };
const layers: Layer[] = [{ id: "a", name: "Black", color: "#1d1d1f" }];
const shapes: Shape[] = [
  { id: "alone", kind: "rect", x: 0.5, y: 0.5, x2: 1, y2: 1, layerId: "a" },
  { id: "one", kind: "rect", x: 1, y: 1, x2: 2, y2: 2, layerId: "a", group: "g1", groupName: "Flower" },
  { id: "two", kind: "ellipse", x: 2, y: 1, x2: 3, y2: 2, rotation: 30, layerId: "a", group: "g1", groupName: "Flower" },
  { id: "hidden", kind: "rect", x: 3, y: 1, x2: 4, y2: 2, outline: false, layerId: "a", group: "g1", groupName: "Flower" },
  { id: "three", kind: "line", x: 5, y: 5, x2: 6, y2: 6, layerId: "a", group: "g2" },
  { id: "four", kind: "line", x: 6, y: 5, x2: 7, y2: 6, layerId: "a", group: "g2" },
];
const file = buildSvg(shapes, [], layers, page, { paperSizeId: "letter", toolName: "" });

test("a shape is written as a group inside its layer", () => {
  assert.match(file, /<g id="studio-group-g1" inkscape:label="Flower">/);
  assert.match(file, /<g id="studio-group-g2">/);
  // Its path that isn't outlined is on the unplotted layer, in a group of the same shape.
  assert.match(file, /<g id="studio-group-g1--sources" inkscape:label="Flower">/);
});

test("its paths come back as the same shape, with its name; a path alone stays alone", () => {
  const back = parseDrawing(file).shapes;
  const of = (id: string) => back.find((s) => s.id === id)!;
  assert.equal(of("alone").group, undefined);
  for (const id of ["one", "two", "hidden"]) {
    assert.equal(of(id).group, "g1", id);
    assert.equal(of(id).groupName, "Flower", id);
  }
  assert.equal(of("three").group, "g2");
  assert.equal(of("four").group, "g2");
  assert.equal(of("three").groupName, undefined);
  assert.equal(of("two").rotation, 30);
});

test("saving what was opened writes the same file again", () => {
  // From the second save on: an unoutlined path is read back after the outlined ones, so the first
  // reopening lists it last - the order Studio has always given such paths.
  const save = (text: string) => {
    const back = parseDrawing(text);
    return buildSvg(back.shapes, back.fills, back.layers, back.page, { paperSizeId: "letter", toolName: "" });
  };
  const once = save(file);
  assert.equal(save(once), once);
});

test("another program's groups are shapes, one level deep, and a wrapper round one path is not", () => {
  const foreign = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="10in" height="10in" viewBox="0 0 960 960">
  <g id="Layer_1">
    <g id="flower">
      <path d="M 10 10 L 20 20"/>
      <g transform="translate(5 0)">
        <path d="M 30 30 L 40 40"/>
        <path d="M 50 50 L 60 60"/>
      </g>
    </g>
    <g transform="translate(100 0)"><path d="M 0 0 L 10 10"/></g>
    <path d="M 70 70 L 80 80"/>
  </g>
</svg>`;
  const back = parseDrawing(foreign).shapes;
  assert.equal(back.length, 5);
  const groups = groupsOf(back);
  assert.equal(groups.size, 1);
  assert.equal([...groups.values()][0].length, 3);
  assert.equal(back.filter((s) => !s.group).length, 2);
});

test("picking one path of a shape picks all of it", () => {
  assert.deepEqual(withWholeGroups(["two"], shapes), ["one", "two", "hidden"]);
  assert.deepEqual(withWholeGroups(["alone", "four"], shapes), ["alone", "three", "four"]);
});
