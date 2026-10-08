import { defineConfig } from "vite";

// pdf.js ships modern syntax (top-level await, private fields); keep esbuild from down-levelling it.
// BASE_PATH: the site's sub-path when it's not served from the domain root. The GitHub Pages
// workflow sets it to "/<repo>/" (https://<user>.github.io/<repo>/); locally it stays "/".
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  server: { open: true },
  build: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
