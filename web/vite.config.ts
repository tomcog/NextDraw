import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two front ends, one build: Plot at index.html and Studio at studio.html. They share this folder so
// they share one install and one version of the component library - the drift between two copies is
// what the single-server decision was meant to avoid (see docs/studio.md).
// The Flask server (server.py) serves the built pages from ../static at /static/.
// During `npm run dev`, Vite proxies /api and /fonts to the running Flask server.
// In dev, the preview opens the bare origin, and Vite sends that to /static/, which is Plot. So
// every time a server started, Plot was what came up, and Studio had to be typed in by hand. The
// bare origin now goes to Studio instead. Plot keeps its own dev address at /static/ and
// /static/index.html, and nothing about the built pages Flask serves changes.
const studioAtTheRoot = () => ({
  name: "studio-at-the-root",
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { writeHead: (code: number, headers: Record<string, string>) => void; end: () => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      // Served at the root rather than redirected to it. A redirect answers 30x, and the harness
      // that runs this server probes the root for a plain 200 before it calls the server ready -
      // it never was, so every one of these was marked unhealthy and eventually stopped under us.
      if (req.url === "/" || req.url === "") req.url = "/static/studio.html";
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), studioAtTheRoot()],
  base: "/static/",
  build: {
    outDir: "../static",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        studio: resolve(__dirname, "studio.html"),
      },
    },
  },
  server: {
    // The port the harness assigns, or the usual one when nothing names it: this dev server has no
    // claim on 5173 - the API proxy below is what matters, and that points at Flask either way.
    port: Number(process.env.PORT) || 5173,
    // /fonts and /tips too: the single-stroke fonts and the drawings of each tool's tip are served
    // by Flask from the repository's fonts/ and tips/ folders.
    proxy: {
      "/api": "http://127.0.0.1:5055",
      "/fonts": "http://127.0.0.1:5055",
      "/tips": "http://127.0.0.1:5055",
    },
  },
});
