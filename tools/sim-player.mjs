// Headless test of movement + collision on a real PDF (Node only, no browser):
// a bot runs around for a few simulated minutes, jumping and turning at random, and we check that
// it never ends up inside a letter it couldn't stand on, never leaves the page, and see how
// often it manages to climb onto text.
//
//   node tools/sim-player.mjs example_cv.pdf

import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { extractPdf } from "../src/pdf/extract.js";
import { makeBodies } from "./bodies.mjs";
import { PlayerCore } from "../src/player/playerCore.js";
import { config as cfg } from "../src/config.js";

const file = process.argv[2] || "example_cv.pdf";
const pdf = await extractPdf(new Uint8Array(fs.readFileSync(file)), { pdfjs, createCanvas, Path2DBase: Path2D }, { rasterScale: 1 });
const { bodies, col, spawn, W, D } = makeBodies(pdf);
const pc = cfg.player;
const player = new PlayerCore(col, pc);
player.reset(spawn.x, spawn.z, 0);
console.log(`page ${W.toFixed(1)} x ${D.toFixed(1)} m, ${bodies.length} bodies, spawn (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)})`);

// deterministic RNG
let seed = Number(process.env.SEED || 12345);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const dt = 1 / 60;
const frames = 60 * 60 * 5; // 5 simulated minutes
let violations = 0, maxPen = 0, onTopFrames = 0, jumps = 0, landings = 0, maxY = 0;
const visited = new Set();
let input = { forward: 1, right: 0, sprint: false, crouch: false };
const t0 = performance.now();
for (let f = 0; f < frames; f++) {
  if (f % 45 === 0) {
    player.yaw += (rnd() - 0.5) * 2.5;
    input = { forward: rnd() < 0.85 ? 1 : -1, right: rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0, sprint: rnd() < 0.4, crouch: rnd() < 0.05 };
  }
  if (rnd() < 0.03) { player.queueJump(); jumps++; }
  const ev = player.step(dt, input);
  if (ev.landed) landings++;

  // check: not overlapping any body taller than our feet + step
  const res = {};
  for (const b of col.query(player.x, player.z, pc.radius)) {
    if (b.height <= player.y + pc.stepHeight) continue;
    col.probe(b, player.x, player.z, pc.radius, res);
    const pen = res.inside ? res.dist + pc.radius : pc.radius - res.dist;
    if (res.overlap && pen > 0.02) {
      violations++;
      maxPen = Math.max(maxPen, pen);
    }
  }
  if (player.x < pc.radius - 1e-6 || player.x > W - pc.radius + 1e-6 || player.z < pc.radius - 1e-6 || player.z > D - pc.radius + 1e-6) violations++;
  if (player.grounded && player.y > 0.1) onTopFrames++;
  maxY = Math.max(maxY, player.y);
  visited.add(`${Math.floor(player.x / 5)},${Math.floor(player.z / 5)}`);
}
const ms = performance.now() - t0;

console.log(`simulated ${(frames * dt).toFixed(0)} s in ${ms.toFixed(0)} ms (${((ms / frames) * 1000).toFixed(1)} µs/frame)`);
console.log(`jumps ${jumps}, landings ${landings}, time standing on letters ${((onTopFrames / frames) * 100).toFixed(1)}%, highest feet ${maxY.toFixed(2)} m`);
console.log(`explored ${visited.size} cells of 5x5 m`);
console.log(`violations: ${violations}${violations ? ` (max penetration ${maxPen.toFixed(3)} m)` : ""}`);
process.exit(violations ? 1 : 0);
