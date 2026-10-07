// Shared by the Node tests: the same collision bodies buildWorld makes, without three.js.
import { pathToPolygons } from "../src/pdf/outlines.js";
import { CollisionWorld, pieceFootprint } from "../src/world/collision.js";
import { makeHeightFn, findSpawn } from "../src/world/layout.js";
import { config as cfg } from "../src/config.js";

export function makeBodies(pdf) {
  const s = cfg.metersPerPt;
  const W = pdf.pageW * s, D = pdf.pageH * s;
  const heightOf = makeHeightFn(pdf, cfg);
  const outlines = new Map();
  const outlineOf = (id) => outlines.get(id) || (outlines.set(id, pathToPolygons(pdf.paths[id], cfg.curveSteps)), outlines.get(id));
  const bodies = pdf.pieces.map((p, i) => ({
    id: i, alive: true, height: heightOf(p),
    box: { minX: p.box[0] * s, minZ: p.box[1] * s, maxX: p.box[2] * s, maxZ: p.box[3] * s },
    footprint: () => pieceFootprint(outlineOf(p.pathId), p.m, s),
  }));
  for (const seg of pdf.segments) {
    const ax = seg.a[0] * s, az = seg.a[1] * s, bx = seg.b[0] * s, bz = seg.b[1] * s;
    const t = Math.max(seg.width * s, cfg.ruleMinThickness);
    const len = Math.hypot(bx - ax, bz - az), nx = (-(bz - az) / len) * t / 2, nz = ((bx - ax) / len) * t / 2;
    bodies.push({
      id: bodies.length, alive: true, height: cfg.ruleHeight,
      box: { minX: Math.min(ax, bx) - t, minZ: Math.min(az, bz) - t, maxX: Math.max(ax, bx) + t, maxZ: Math.max(az, bz) + t },
      footprint: () => [{ outer: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], holes: [] }],
    });
  }
  const col = new CollisionWorld(bodies, { W, D });
  const spawn = findSpawn(bodies, W, D, cfg.player.radius);
  return { bodies, col, spawn, W, D, cfg };
}
