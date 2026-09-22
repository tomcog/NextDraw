// The one rule the folders are for: shared code may not know which app is using it, and the two
// apps may not reach into each other. Without this the boundary is a naming convention, and a
// convention is exactly what drifted before the folders existed.
//
// Run by `npm run build`, so a crossing cannot ship. `npm run check` runs it on its own.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = d + n;
  return statSync(p).isDirectory() ? walk(p + "/") : [p];
});
const areaOf = (file) => relative(SRC, file).split("/")[0];

const FORBIDDEN = {
  shared: ["plot", "studio"],   // shared serves both, so it may know neither
  plot: ["studio"],
  studio: ["plot"],
};

const bad = [];
for (const file of walk(SRC).filter((f) => /\.tsx?$/.test(f))) {
  const from = areaOf(file);
  const banned = FORBIDDEN[from];
  if (!banned) continue;
  for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s+"(\.[^"]+)"/g)) {
    const to = areaOf(resolve(dirname(file), spec));
    if (banned.includes(to)) bad.push(`  ${relative(SRC, file)}\n      imports ${spec}  (${from} -> ${to})`);
  }
}
if (bad.length) {
  console.error(`\nBoundary crossings (${bad.length}):\n${bad.join("\n")}\n`);
  console.error("Shared code cannot import an app. If both apps need it, move it into src/shared.\n");
  process.exit(1);
}
console.log(`Boundaries hold: shared knows neither app, and the apps do not import each other.`);
