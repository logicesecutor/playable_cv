// Turns one PDF page into plain data: every filled shape (glyphs, icons, boxes) as path
// commands + transform + colour, every stroke as merged straight segments, plus a raster of the
// page. Works in the browser and in Node (pass a canvas factory and Path2D base class).
//
// How: pdf.js is told to draw glyphs as vector paths (disableFontFace). While it renders, the
// global Path2D is swapped for a subclass that records its commands, and ctx.fill / ctx.stroke
// are wrapped to capture (path, current transform, colour). Coordinates come out in PDF points,
// y pointing down, origin at the page's top-left.

import { M, L, C, Q, Z } from "./pathOps.js";

/**
 * @param {Uint8Array} data             PDF bytes
 * @param {object} env
 * @param {object} env.pdfjs            the pdf.js module
 * @param {(w:number,h:number)=>any} env.createCanvas
 * @param {typeof Path2D} env.Path2DBase native Path2D class to extend
 * @param {object} [opts]
 * @param {number} [opts.pageNumber=1]
 * @param {number} [opts.rasterScale=3] pixels per PDF point for the page raster
 */
export async function extractPdf(data, env, opts = {}) {
  const { pdfjs, createCanvas, Path2DBase } = env;
  const pageNumber = opts.pageNumber ?? 1;
  const rasterScale = opts.rasterScale ?? 3;

  const task = pdfjs.getDocument({
    data,
    disableFontFace: true, // glyphs drawn as paths, so we can capture them
    fontExtraProperties: true,
    isEvalSupported: false,
  });
  const doc = await task.promise;

  try {
    const page = await doc.getPage(pageNumber);
    const vp1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: rasterScale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    const RecordingPath2D = makeRecordingPath2D(Path2DBase);
    const fills = [];
    const strokes = [];
    const origFill = ctx.fill;
    const origStroke = ctx.stroke;

    ctx.fill = function (path, rule) {
      if (path && path.cmds) {
        fills.push({ cmds: path.cmds, m: matrixOf(ctx), style: ctx.fillStyle, rule: rule || "nonzero" });
      }
      return path ? origFill.call(ctx, path, rule) : origFill.call(ctx);
    };
    ctx.stroke = function (path) {
      if (path && path.cmds) {
        strokes.push({ cmds: path.cmds, m: matrixOf(ctx), style: ctx.strokeStyle, lw: ctx.lineWidth });
      }
      return path ? origStroke.call(ctx, path) : origStroke.call(ctx);
    };

    const savedPath2D = globalThis.Path2D;
    globalThis.Path2D = RecordingPath2D;
    try {
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    } finally {
      globalThis.Path2D = savedPath2D;
      ctx.fill = origFill;
      ctx.stroke = origStroke;
    }

    const pageW = vp1.width;
    const pageH = vp1.height;
    const inv = 1 / rasterScale;

    // ---- fills -> pieces, with shared path ids so identical glyphs can be instanced
    const pathIds = new Map(); // cmds array -> id
    const paths = []; // id -> Float64Array of commands (local coordinates)
    const pieces = [];
    for (const f of fills) {
      const color = parseColor(f.style);
      if (!color) continue; // gradients / patterns: skip for now
      if (luminance(color) > 0.92) continue; // white-on-white backgrounds are invisible anyway
      const m = f.m.map((v) => v * inv); // raster pixels -> PDF points
      const bbox = localBBox(f.cmds);
      if (!bbox) continue;
      const pageBox = transformBBox(bbox, m);
      const area = (pageBox[2] - pageBox[0]) * (pageBox[3] - pageBox[1]);
      if (area > pageW * pageH * 0.5) continue; // page-sized background
      let id = pathIds.get(f.cmds);
      if (id === undefined) {
        id = paths.length;
        pathIds.set(f.cmds, id);
        paths.push(Float64Array.from(f.cmds));
      }
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      // Glyph outlines live in em space (about 0..1) and get scaled by the font size; vector art
      // is already in points. That difference tells the two apart well enough.
      const localSize = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
      const isGlyph = localSize <= 2.5 && scale >= 2;
      pieces.push({
        id: pieces.length,
        pathId: id,
        m,
        color,
        isGlyph,
        fontSize: isGlyph ? scale : null,
        box: pageBox, // [minX, minY, maxX, maxY] in points, y down
      });
    }

    // ---- strokes -> merged straight segments
    const rawSegments = [];
    for (const s of strokes) {
      const color = parseColor(s.style);
      if (!color || luminance(color) > 0.92) continue;
      const m = s.m.map((v) => v * inv);
      const width = s.lw * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      for (const [a, b] of strokeSegments(s.cmds)) {
        rawSegments.push({
          a: apply(m, a[0], a[1]),
          b: apply(m, b[0], b[1]),
          width,
          color,
        });
      }
    }
    const segments = mergeSegments(rawSegments);

    return { pageW, pageH, rasterScale, raster: canvas, paths, pieces, segments, numPages: doc.numPages };
  } finally {
    // keep the raster canvas, drop the document
    task.destroy();
  }
}

// ---------------------------------------------------------------------------------------------

function makeRecordingPath2D(Base) {
  return class RecordingPath2D extends Base {
    constructor(arg) {
      super(arg);
      this.cmds = arg && arg.cmds ? arg.cmds.slice() : [];
    }
    moveTo(x, y) { this.cmds.push(M, x, y); super.moveTo(x, y); }
    lineTo(x, y) { this.cmds.push(L, x, y); super.lineTo(x, y); }
    bezierCurveTo(a, b, c, d, e, f) { this.cmds.push(C, a, b, c, d, e, f); super.bezierCurveTo(a, b, c, d, e, f); }
    quadraticCurveTo(a, b, c, d) { this.cmds.push(Q, a, b, c, d); super.quadraticCurveTo(a, b, c, d); }
    closePath() { this.cmds.push(Z); super.closePath(); }
    rect(x, y, w, h) {
      this.cmds.push(M, x, y, L, x + w, y, L, x + w, y + h, L, x, y + h, Z);
      super.rect(x, y, w, h);
    }
    addPath(p, mat) {
      if (p && p.cmds) {
        const t = mat ? [mat.a, mat.b, mat.c, mat.d, mat.e, mat.f] : [1, 0, 0, 1, 0, 0];
        this.cmds.push(...transformCmds(p.cmds, t));
      }
      super.addPath(p, mat);
    }
  };
}

function matrixOf(ctx) {
  const t = ctx.getTransform();
  return [t.a, t.b, t.c, t.d, t.e, t.f];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function transformCmds(cmds, m) {
  const out = [];
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i++];
    out.push(op);
    const n = op === M || op === L ? 1 : op === C ? 3 : op === Q ? 2 : 0;
    for (let k = 0; k < n; k++) {
      const [x, y] = apply(m, cmds[i++], cmds[i++]);
      out.push(x, y);
    }
  }
  return out;
}

function localBBox(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i++];
    const n = op === M || op === L ? 1 : op === C ? 3 : op === Q ? 2 : 0;
    for (let k = 0; k < n; k++) {
      const x = cmds[i++], y = cmds[i++];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

function transformBBox(b, m) {
  const pts = [apply(m, b[0], b[1]), apply(m, b[2], b[1]), apply(m, b[2], b[3]), apply(m, b[0], b[3])];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Straight pieces of a stroked path (curves flattened coarsely; CV strokes are nearly always lines).
function strokeSegments(cmds) {
  const segs = [];
  let cur = null, start = null;
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i++];
    if (op === M) { cur = [cmds[i++], cmds[i++]]; start = cur; }
    else if (op === L) { const p = [cmds[i++], cmds[i++]]; if (cur) segs.push([cur, p]); cur = p; }
    else if (op === C) {
      const c1 = [cmds[i++], cmds[i++]], c2 = [cmds[i++], cmds[i++]], p = [cmds[i++], cmds[i++]];
      if (cur) {
        let prev = cur;
        for (let k = 1; k <= 6; k++) {
          const t = k / 6, u = 1 - t;
          const q = [
            u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0],
            u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1],
          ];
          segs.push([prev, q]); prev = q;
        }
      }
      cur = p;
    } else if (op === Q) { i += 2; const p = [cmds[i++], cmds[i++]]; if (cur) segs.push([cur, p]); cur = p; }
    else if (op === Z) { if (cur && start) segs.push([cur, start]); cur = start; }
  }
  return segs.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6);
}

// LaTeX rules often come out as hundreds of tiny dashes; join the ones that continue each other.
function mergeSegments(raw) {
  const out = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && sameColor(last.color, s.color) && Math.abs(last.width - s.width) < 0.05) {
      const dx = last.b[0] - last.a[0], dy = last.b[1] - last.a[1];
      const len = Math.hypot(dx, dy);
      const ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1];
      const elen = Math.hypot(ex, ey);
      const parallel = Math.abs(dx * ey - dy * ex) / (len * elen) < 0.01 && dx * ex + dy * ey > 0;
      const gap = Math.hypot(s.a[0] - last.b[0], s.a[1] - last.b[1]);
      // and the new start lies on the line of the previous one
      const offLine = Math.abs((s.a[0] - last.a[0]) * dy - (s.a[1] - last.a[1]) * dx) / len;
      if (parallel && gap < 1.5 && offLine < 0.2) {
        last.b = s.b;
        continue;
      }
    }
    out.push({ a: s.a.slice(), b: s.b.slice(), width: s.width, color: s.color });
  }
  return out;
}

function parseColor(style) {
  if (typeof style !== "string") return null;
  let m = /^#([0-9a-f]{6})$/i.exec(style);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(style);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    if (p.length === 4 && p[3] === 0) return null;
    return [p[0] / 255, p[1] / 255, p[2] / 255];
  }
  return null;
}

function luminance(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function sameColor(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 0.02;
}
