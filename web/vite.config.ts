import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Flask server (server.py) serves the built page from ../static at /static/.
// During `npm run dev`, Vite proxies /api to the running Flask server.
export default defineConfig({
  plugins: [react()],
  base: "/static/",
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:5055" },
  },
});
