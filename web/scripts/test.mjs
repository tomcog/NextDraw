// Runs the web code's tests: each tests/*.test.ts is bundled with esbuild (which comes with Vite)
// into a temporary folder, then run by Node's own test runner. No test framework to install.
import { build } from "esbuild";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("../tests/", import.meta.url));
const tests = readdirSync(here).filter((n) => n.endsWith(".test.ts"));
const out = mkdtempSync(join(tmpdir(), "nextdraw-tests-"));
try {
  await build({
    entryPoints: tests.map((n) => join(here, n)),
    outdir: out,
    bundle: true,
    platform: "node",
    format: "esm",
    outExtension: { ".js": ".mjs" },
    logLevel: "warning",
  });
  const run = spawnSync(process.execPath, ["--test", ...tests.map((n) => join(out, n.replace(/\.ts$/, ".mjs")))], { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
