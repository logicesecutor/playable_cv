// Pure geometry: recorded path commands -> polygons grouped into outer contours with holes.
// Hole detection uses containment depth (even = solid, odd = hole), which works for both
// TrueType and PostScript winding conventions and for odd PDF producers.

import { M, L, C, Q, Z } from "./pathOps.js";

/**
 * @param {ArrayLike<number>} cmds
 * @param {number} [curveSteps=6] line segments per curve
 * @returns {{outer:number[][], holes:number[][][]}[]} points as [x, y]
 */
export function pathToPolygons(cmds, curveSteps = 6) {
  const contours = flatten(cmds, curveSteps)
    .map((pts) => cleanup(pts))
    .filter((pts) => pts.length >= 3)
    .map((pts) => ({ pts, area: Math.abs(signedArea(pts)), bbox: bboxOf(pts), depth: 0, parent: null }))
    .filter((c) => c.area > 1e-7);

  // biggest first so parents are resolved before children
  contours.sort((a, b) => b.area - a.area);
  for (let i = 0; i < contours.length; i++) {
    const c = contours[i];
    // smallest earlier contour containing this one is its parent
    for (let j = i - 1; j >= 0; j--) {
      const p = contours[j];
      if (!bboxInside(c.bbox, p.bbox)) continue;
      if (contains(p.pts, c)) {
        c.parent = p;
        c.depth = p.depth + 1;
        break;
      }
    }
  }

  const shapes = new Map();
  for (const c of contours) {
    if (c.depth % 2 === 0) shapes.set(c, { outer: c.pts, holes: [] });
  }
  for (const c of contours) {
    if (c.depth % 2 === 1) shapes.get(c.parent)?.holes.push(c.pts);
  }
  return [...shapes.values()];
}

function flatten(cmds, steps) {
  const out = [];
  let cur = null;
  let x = 0, y = 0;
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i++];
    if (op === M) {
      if (cur && cur.length) out.push(cur);
      x = cmds[i++]; y = cmds[i++];
      cur = [[x, y]];
    } else if (op === L) {
      x = cmds[i++]; y = cmds[i++];
      (cur ||= [[x, y]]).push([x, y]);
    } else if (op === C) {
      const c1x = cmds[i++], c1y = cmds[i++], c2x = cmds[i++], c2y = cmds[i++], ex = cmds[i++], ey = cmds[i++];
      cur ||= [[x, y]];
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t;
        cur.push([
          u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        ]);
      }
      x = ex; y = ey;
    } else if (op === Q) {
      const cx = cmds[i++], cy = cmds[i++], ex = cmds[i++], ey = cmds[i++];
      cur ||= [[x, y]];
      const n = Math.max(2, Math.ceil(steps * 0.7));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey]);
      }
      x = ex; y = ey;
    } else if (op === Z) {
      if (cur && cur.length) {
        out.push(cur);
        x = cur[0][0]; y = cur[0][1];
      }
      cur = null;
    }
  }
  if (cur && cur.length) out.push(cur);
  return out;
}

// drop duplicate consecutive points and the closing duplicate
function cleanup(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop();
  }
  return out;
}

export function signedArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function bboxInside(inner, outer) {
  const e = 1e-6;
  return inner[0] >= outer[0] - e && inner[1] >= outer[1] - e && inner[2] <= outer[2] + e && inner[3] <= outer[3] + e;
}

// majority vote over a few vertices, so a contour that touches its parent still classifies
function contains(poly, c) {
  const pts = c.pts;
  const step = Math.max(1, Math.floor(pts.length / 5));
  let inside = 0, total = 0;
  for (let i = 0; i < pts.length; i += step) {
    total++;
    if (pointInPolygon(pts[i][0], pts[i][1], poly)) inside++;
  }
  return inside * 2 > total;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
