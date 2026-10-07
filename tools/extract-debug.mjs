// Debug tool (Node only): runs the extractor on a PDF, prints stats and writes
//   <name>.raster.png        the page as pdf.js rendered it
//   <name>.rebuilt.png       the page redrawn ONLY from extracted polygons + segments
// If the two images match, the 3D map will match the CV.
//
//   npm run extract -- example_cv.pdf

import fs from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { extractPdf } from "../src/pdf/extract.js";
import { pathToPolygons } from "../src/pdf/outlines.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run extract -- <file.pdf> [outDir]");
  process.exit(1);
}
const outDir = process.argv[3] || "debug";
fs.mkdirSync(outDir, { recursive: true });
const base = path.join(outDir, path.basename(file, ".pdf"));

const data = new Uint8Array(fs.readFileSync(file));
const t0 = performance.now();
const res = await extractPdf(data, { pdfjs, createCanvas, Path2DBase: Path2D }, { rasterScale: 3 });
const t1 = performance.now();

const glyphs = res.pieces.filter((p) => p.isGlyph);
const sizes = {};
for (const g of glyphs) sizes[g.fontSize.toFixed(1)] = (sizes[g.fontSize.toFixed(1)] || 0) + 1;
console.log(`page ${res.pageW.toFixed(1)} x ${res.pageH.toFixed(1)} pt, ${res.numPages} page(s), ${(t1 - t0).toFixed(0)} ms`);
console.log(`pieces: ${res.pieces.length} (${glyphs.length} glyphs, ${res.pieces.length - glyphs.length} vector fills)`);
console.log(`unique paths: ${res.paths.length}`);
console.log(`segments (merged strokes): ${res.segments.length}`);
console.log("font sizes:", sizes);

fs.writeFileSync(`${base}.raster.png`, res.raster.toBuffer("image/png"));

// rebuild from polygons
const s = 3;
const cv = createCanvas(Math.ceil(res.pageW * s), Math.ceil(res.pageH * s));
const ctx = cv.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, cv.width, cv.height);
const polyCache = new Map();
let holes = 0, shapes = 0;
for (const p of res.pieces) {
  let polys = polyCache.get(p.pathId);
  if (!polys) polyCache.set(p.pathId, (polys = pathToPolygons(res.paths[p.pathId])));
  const [a, b, c, d, e, f] = p.m;
  ctx.setTransform(a * s, b * s, c * s, d * s, e * s, f * s);
  ctx.fillStyle = `rgb(${p.color.map((v) => Math.round(v * 255)).join(",")})`;
  for (const poly of polys) {
    shapes++;
    holes += poly.holes.length;
    ctx.beginPath();
    for (const ring of [poly.outer, ...poly.holes]) {
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
}
ctx.setTransform(s, 0, 0, s, 0, 0);
for (const g of res.segments) {
  ctx.strokeStyle = "rgb(220,0,0)"; // red so merged rules are easy to spot
  ctx.lineWidth = Math.max(g.width, 0.6);
  ctx.beginPath();
  ctx.moveTo(...g.a);
  ctx.lineTo(...g.b);
  ctx.stroke();
}
fs.writeFileSync(`${base}.rebuilt.png`, cv.toBuffer("image/png"));
console.log(`shapes: ${shapes}, holes: ${holes}`);
console.log(`wrote ${base}.raster.png and ${base}.rebuilt.png`);
