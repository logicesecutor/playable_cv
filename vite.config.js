import { defineConfig } from "vite";

// pdf.js ships modern syntax (top-level await, private fields); keep esbuild from down-levelling it.
export default defineConfig({
  server: { open: true },
  build: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
