// Node test: grid-walking raycast == brute force over every body, on a real PDF.
//   node tools/test-raycast.mjs example_cv.pdf
import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { extractPdf } from "../src/pdf/extract.js";
import { makeBodies } from "./bodies.mjs";

const pdf = await extractPdf(new Uint8Array(fs.readFileSync(process.argv[2] || "example_cv.pdf")), { pdfjs, createCanvas, Path2DBase: Path2D }, { rasterScale: 1 });
const { col, spawn, bodies, W, D } = makeBodies(pdf);

let seed = 99;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let mismatches = 0, hitsBody = 0, hitsFloor = 0, misses = 0, n = 3000;
let tFast = 0, tBrute = 0;
for (let i = 0; i < n; i++) {
  // random origins: half from the spawn at eye height, half anywhere on the map / in the air
  const ox = i % 2 ? spawn.x : rnd() * W, oz = i % 2 ? spawn.z : rnd() * D, oy = i % 2 ? 1.65 : 0.2 + rnd() * 8;
  const yaw = rnd() * Math.PI * 2, pitch = (rnd() - 0.6) * 0.8;
  const dx = Math.cos(pitch) * Math.sin(yaw), dy = Math.sin(pitch), dz = Math.cos(pitch) * Math.cos(yaw);
  let a = performance.now();
  const fast = col.raycast(ox, oy, oz, dx, dy, dz, 400);
  tFast += performance.now() - a;
  a = performance.now();
  // brute force
  let best = dy < 0 ? { t: -oy / dy, body: null } : null;
  if (best && best.t > 400) best = null;
  const out = {};
  for (const b of bodies) {
    if (col.rayBody(b, ox, oy, oz, dx, dy, dz, best ? best.t : 400, out)) best = { t: out.t, body: b };
  }
  tBrute += performance.now() - a;
  const same = (!fast && !best) || (fast && best && Math.abs(fast.t - best.t) < 1e-6 && fast.body === best.body);
  if (!same) { mismatches++; if (mismatches < 5) console.log("mismatch", { ox, oy, oz, dx, dy, dz, fast: fast && [fast.t, fast.body?.id], brute: best && [best.t, best.body?.id] }); }
  if (!fast) misses++; else if (fast.body) hitsBody++; else hitsFloor++;
}
console.log(`${n} rays: ${hitsBody} hit letters, ${hitsFloor} hit floor, ${misses} missed`);
console.log(`grid raycast ${((tFast / n) * 1000).toFixed(1)} µs/ray vs brute force ${((tBrute / n) * 1000).toFixed(1)} µs/ray`);
console.log(`mismatches: ${mismatches}`);
process.exit(mismatches ? 1 : 0);
