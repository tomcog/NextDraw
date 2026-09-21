import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two front ends, one build: Plot at index.html and Studio at studio.html. They share this folder so
// they share one install and one version of the component library - the drift between two copies is
// what the single-server decision was meant to avoid (see docs/studio.md).
// The Flask server (server.py) serves the built pages from ../static at /static/.
// During `npm run dev`, Vite proxies /api and /fonts to the running Flask server.
export default defineConfig({
  plugins: [react()],
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
    port: 5173,
    // /fonts and /tips too: the single-stroke fonts and the drawings of each tool's tip are served
    // by Flask from the repository's fonts/ and tips/ folders.
    proxy: {
      "/api": "http://127.0.0.1:5055",
      "/fonts": "http://127.0.0.1:5055",
      "/tips": "http://127.0.0.1:5055",
    },
  },
});
