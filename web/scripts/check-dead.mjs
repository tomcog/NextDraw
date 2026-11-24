// What nothing calls, and what nothing outside its own file calls. Both grow by themselves: a
// feature changes shape, its helpers stay behind, and the next person can't tell a leftover from
// something load-bearing. 58 of them had gathered by 2026-11-24, and every one needed reading to
// find out which it was.
//
// Two findings, and they are different:
//   - a name NOTHING refers to, its own file included, is dead and should be deleted;
//   - a name only its own file refers to is alive but over-exported: drop the `export`, and the
//     check above gets sharper, because an export now means someone else really does use it.
//
// Run by `npm run build`, so neither can ship. `npm run dead` runs it on its own.
//
// It reads the source as text rather than building a graph of it: names here are distinctive enough
// that a word-boundary search is exact, and a 40-line script that anyone can read is worth more than
// a dependency. Two costs come with that: a name also used as a property or a string somewhere will
// look used, and `export default` is not checked at all (the apps don't use it).
import { readdirSync, statSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const TESTS = fileURLToPath(new URL("../tests/", import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = d + n;
  return statSync(p).isDirectory() ? walk(p + "/") : [p];
});

const files = [...walk(SRC), ...walk(TESTS)].filter((f) => /\.tsx?$/.test(f));
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

// Declarations only: `export const x`, `export function x`, `export class x`. Types and interfaces
// are left alone - a Props interface beside its component is a way of writing, not a surface.
const DECLARED = /^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm;

const dead = [];
const local = [];
for (const [file, source] of text) {
  for (const [, name] of source.matchAll(DECLARED)) {
    const word = new RegExp(`\\b${name}\\b`);
    const elsewhere = files.some((other) => other !== file && word.test(text.get(other)));
    if (elsewhere) continue;
    // Its own file: the declaration itself is one mention, so anything more is a use.
    const mine = (source.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    (mine > 1 ? local : dead).push(`  ${relative(SRC, file)}: ${name}`);
  }
}

if (dead.length || local.length) {
  if (dead.length) {
    console.error(`\nNothing calls these (${dead.length}) - delete them:\n${dead.join("\n")}`);
  }
  if (local.length) {
    console.error(`\nOnly their own file calls these (${local.length}) - drop the \`export\`:\n${local.join("\n")}`);
  }
  console.error("");
  process.exit(1);
}
console.log("No dead exports: everything exported is used by someone else.");
