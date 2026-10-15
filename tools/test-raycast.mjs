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

// tray walls (world/office.js sets them in the game): a box 10 m around the page, 50 m tall.
// Every ray from the page that would leave it below the wall tops must stop at a wall, never
// fly on; rays over the top or into the floor / letters are unaffected.
const m = 10, H = 50, x0 = -m, x1 = W + m, z0 = -m, z1 = D + m;
col.walls = [
  { ax: x0, az: z0, bx: x1, bz: z0, h0: H, h1: H }, { ax: x1, az: z0, bx: x1, bz: z1, h0: H, h1: H },
  { ax: x1, az: z1, bx: x0, bz: z1, h0: H, h1: H }, { ax: x0, az: z1, bx: x0, bz: z0, h0: H, h1: H },
];
let wallHits = 0, wallErrors = 0;
for (let i = 0; i < 2000; i++) {
  const ox = rnd() * W, oz = rnd() * D, oy = 1.65;
  const yaw = rnd() * Math.PI * 2, pitch = (rnd() - 0.3) * 0.5;
  const dx = Math.cos(pitch) * Math.sin(yaw), dy = Math.sin(pitch), dz = Math.cos(pitch) * Math.cos(yaw);
  const hit = col.raycast(ox, oy, oz, dx, dy, dz, 400);
  // where would it cross the box, and how high?
  const tx = dx > 0 ? (x1 - ox) / dx : dx < 0 ? (x0 - ox) / dx : Infinity;
  const tz = dz > 0 ? (z1 - oz) / dz : dz < 0 ? (z0 - oz) / dz : Infinity;
  const tw = Math.min(tx, tz), yw = oy + dy * tw;
  const shouldWall = tw < 400 && yw >= 0 && yw <= H;
  if (hit?.wall) wallHits++;
  if (shouldWall && !hit) wallErrors++; // flew through the wall
  if (hit?.wall && Math.abs(hit.t - tw) > 1e-6) wallErrors++; // stopped somewhere else
  if (hit?.wall && !shouldWall) wallErrors++;
}
col.walls = [];
console.log(`walls: ${wallHits} of 2000 rays stopped by a tray wall, errors ${wallErrors}`);
process.exit(mismatches || wallErrors ? 1 : 0);
