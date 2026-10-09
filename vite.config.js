import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// pdf.js ships modern syntax (top-level await, private fields); keep esbuild from down-levelling it.
// BASE_PATH: the site's sub-path when it's not served from the domain root. The GitHub Pages
// workflow sets it to "/<repo>/" (https://<user>.github.io/<repo>/); locally it stays "/".
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  // the version shown on the first page ("prototype · v0.4.0") comes from package.json
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { open: true },
  build: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
