// Collision against the real letter footprints (pure JS, no three.js, so it can be tested in Node).
//
// Every entity is a vertical prism: a 2D footprint (outline polygons with holes) on the XZ
// plane, from y = 0 up to y = height. The player is a vertical cylinder. That makes the problem
// 2D: circle vs polygon, plus a height check. Holes are real, so you can stand inside the "o"
// of a big letter.

/**
 * @typedef {{outer:number[][], holes:number[][][]}} Poly   points [x, z] in world metres
 * @typedef {{id:number, alive:boolean, height:number,
 *   box:{minX:number,minZ:number,maxX:number,maxZ:number}, footprint?:()=>Poly[]}} Body
 */

export class CollisionWorld {
  /**
   * @param {Body[]} bodies
   * @param {{W:number, D:number}} size
   * @param {number} [cell=4] grid cell size in metres
   */
  constructor(bodies, size, cell = 4) {
    this.bodies = bodies;
    this.size = size;
    this.cell = cell;
    this.cols = Math.ceil(size.W / cell) + 1;
    this.rows = Math.ceil(size.D / cell) + 1;
    this.grid = new Map();
    this.polys = new Map(); // body id -> Poly[] (built lazily)
    this.stamp = 0;
    this.marks = new Uint32Array(bodies.length + 1);
    for (const b of bodies) this.insert(b);
  }

  insert(b) {
    const { cell } = this;
    const x0 = Math.max(0, Math.floor(b.box.minX / cell)), x1 = Math.min(this.cols - 1, Math.floor(b.box.maxX / cell));
    const z0 = Math.max(0, Math.floor(b.box.minZ / cell)), z1 = Math.min(this.rows - 1, Math.floor(b.box.maxZ / cell));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const k = z * this.cols + x;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
      }
    }
  }

  /** alive bodies whose bounding box touches the square around (x, z) */
  query(x, z, r, out = []) {
    out.length = 0;
    const { cell } = this;
    const stamp = ++this.stamp;
    const x0 = Math.max(0, Math.floor((x - r) / cell)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / cell));
    const z0 = Math.max(0, Math.floor((z - r) / cell)), z1 = Math.min(this.rows - 1, Math.floor((z + r) / cell));
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const list = this.grid.get(gz * this.cols + gx);
        if (!list) continue;
        for (const b of list) {
          if (!b.alive || this.marks[b.id] === stamp) continue;
          this.marks[b.id] = stamp;
          const bb = b.box;
          if (x + r < bb.minX || x - r > bb.maxX || z + r < bb.minZ || z - r > bb.maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  polysOf(b) {
    let p = this.polys.get(b.id);
    if (!p) this.polys.set(b.id, (p = b.footprint()));
    return p;
  }

  /**
   * How a circle at (x, z) relates to a body's footprint.
   * @returns {{overlap:boolean, inside:boolean, dist:number, nx:number, nz:number}}
   *   (nx, nz) is the unit direction to push the circle out, dist the distance to the outline
   */
  probe(b, x, z, r, res = {}) {
    const polys = this.polysOf(b);
    let inside = false;
    let best = Infinity, qx = 0, qz = 0, ex = 0, ez = 0;
    for (const poly of polys) {
      if (!inside && pointInRing(x, z, poly.outer)) {
        inside = true;
        for (const h of poly.holes) if (pointInRing(x, z, h)) { inside = false; break; }
      }
      for (const ring of [poly.outer, ...poly.holes]) {
        for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
          const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
          const dx = bx - ax, dz = bz - az;
          const len2 = dx * dx + dz * dz || 1e-12;
          let t = ((x - ax) * dx + (z - az) * dz) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t, pz = az + dz * t;
          const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
          if (d2 < best) { best = d2; qx = px; qz = pz; ex = dx; ez = dz; }
        }
      }
    }
    const dist = Math.sqrt(best);
    let nx, nz;
    if (dist > 1e-6) {
      // away from the outline if outside, towards (and through) it if inside
      nx = (x - qx) / dist; nz = (z - qz) / dist;
      if (inside) { nx = -nx; nz = -nz; }
    } else {
      // exactly on the outline: use the edge normal, pick the side that is outside
      const l = Math.hypot(ex, ez) || 1;
      nx = -ez / l; nz = ex / l;
      if (this.solidAt(b, x + nx * 1e-3, z + nz * 1e-3)) { nx = -nx; nz = -nz; }
    }
    res.inside = inside;
    res.dist = dist;
    res.overlap = inside || dist < r;
    res.nx = nx; res.nz = nz;
    return res;
  }

  solidAt(b, x, z) {
    for (const poly of this.polysOf(b)) {
      if (!pointInRing(x, z, poly.outer)) continue;
      let hole = false;
      for (const h of poly.holes) if (pointInRing(x, z, h)) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }

  /**
   * Highest top under a circle that the player can stand on (top <= feetY + step).
   * Uses a slightly smaller circle so you don't hang on a sliver of an edge.
   */
  supportHeight(x, z, r, feetY, step) {
    let h = 0;
    const res = {};
    for (const b of this.query(x, z, r, this._q1 || (this._q1 = []))) {
      if (b.height <= h || b.height > feetY + step) continue;
      this.probe(b, x, z, r * 0.7, res);
      if (res.overlap) h = b.height;
    }
    return h;
  }

  /**
   * Push a circle out of every body taller than feetY + step. Returns the corrected position.
   * @returns {{x:number, z:number, hit:boolean}}
   */
  resolve(x, z, r, feetY, step, iterations = 8) {
    const res = {};
    let hit = false;
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      for (const b of this.query(x, z, r, this._q2 || (this._q2 = []))) {
        if (b.height <= feetY + step) continue; // low enough to step onto / stand on
        this.probe(b, x, z, r, res);
        if (!res.overlap) continue;
        const push = res.inside ? res.dist + r + 1e-4 : r - res.dist + 1e-4;
        x += res.nx * push;
        z += res.nz * push;
        moved = hit = true;
      }
      if (!moved) break;
    }
    // stay on the page
    const { W, D } = this.size;
    x = Math.min(W - r, Math.max(r, x));
    z = Math.min(D - r, Math.max(r, z));
    return { x, z, hit };
  }

  /** height of the tallest alive body whose solid footprint contains (x, z); 0 if none */
  topAt(x, z) {
    let h = 0;
    for (const b of this.query(x, z, 0, this._q3 || (this._q3 = []))) {
      if (b.height > h && this.solidAt(b, x, z)) h = b.height;
    }
    return h;
  }

  /**
   * Ray vs every letter prism (sides + top) and the floor (y = 0).
   * Walks the grid cells along the ray (DDA) and stops as soon as the closest hit is known.
   * (dx, dy, dz) must be normalised; t is the distance along it.
   * @returns {null | {t:number, body:Body|null, x:number, y:number, z:number, nx:number, ny:number, nz:number}}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT = 500) {
    // floor
    let best = null;
    if (dy < -1e-6) {
      const tf = -oy / dy;
      if (tf > 0 && tf < maxT) {
        maxT = tf;
        best = { t: tf, body: null, x: ox + dx * tf, y: 0, z: oz + dz * tf, nx: 0, ny: 1, nz: 0 };
      }
    }

    const { cell, cols, rows } = this;
    let gx = Math.floor(ox / cell), gz = Math.floor(oz / cell);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? cell / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? cell / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (gx + 1) * cell : gx * cell) - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (gz + 1) * cell : gz * cell) - oz) / dz : Infinity;
    const stamp = ++this.stamp;
    const hit = {};
    let tCell = 0;

    for (let guard = 0; guard < 4096; guard++) {
      if (gx >= 0 && gz >= 0 && gx < cols && gz < rows) {
        const list = this.grid.get(gz * cols + gx);
        if (list) {
          for (const b of list) {
            if (!b.alive || this.marks[b.id] === stamp) continue;
            this.marks[b.id] = stamp;
            if (this.rayBody(b, ox, oy, oz, dx, dy, dz, best ? best.t : maxT, hit)) {
              best = { t: hit.t, body: b, x: ox + dx * hit.t, y: oy + dy * hit.t, z: oz + dz * hit.t, nx: hit.nx, ny: hit.ny, nz: hit.nz };
            }
          }
        }
      } else if ((stepX > 0 ? gx >= cols : gx < 0) || (stepZ > 0 ? gz >= rows : gz < 0)) {
        // left the grid and moving away from it
        if (tCell > 0) break;
      }
      // next cell
      const tNext = Math.min(tMaxX, tMaxZ);
      if (best && best.t <= tNext) break; // nothing in later cells can be closer
      if (tNext > maxT) break;
      tCell = tNext;
      if (tMaxX < tMaxZ) { gx += stepX; tMaxX += tDeltaX; }
      else { gz += stepZ; tMaxZ += tDeltaZ; }
    }
    return best;
  }

  /** closest hit of the ray with one prism closer than maxT; fills out {t, nx, ny, nz} */
  rayBody(b, ox, oy, oz, dx, dy, dz, maxT, out) {
    let best = maxT, found = false;
    const H = b.height;
    for (const poly of this.polysOf(b)) {
      for (const ring of [poly.outer, ...poly.holes]) {
        for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
          const ax = ring[j][0], az = ring[j][1];
          const ex = ring[i][0] - ax, ez = ring[i][1] - az;
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-12) continue;
          const wx = ax - ox, wz = az - oz;
          const t = (wx * ez - wz * ex) / den;
          if (t <= 1e-5 || t >= best) continue;
          const u = (wx * dz - wz * dx) / den;
          if (u < 0 || u > 1) continue;
          const y = oy + dy * t;
          if (y < 0 || y > H) continue;
          best = t; found = true;
          const l = Math.hypot(ex, ez) || 1;
          let nx = ez / l, nz = -ex / l;
          if (nx * dx + nz * dz > 0) { nx = -nx; nz = -nz; }
          out.nx = nx; out.ny = 0; out.nz = nz;
        }
      }
    }
    // top cap
    if (dy < -1e-9 && oy >= H) {
      const t = (H - oy) / dy;
      if (t > 1e-5 && t < best && this.solidAt(b, ox + dx * t, oz + dz * t)) {
        best = t; found = true;
        out.nx = 0; out.ny = 1; out.nz = 0;
      }
    }
    if (found) out.t = best;
    return found;
  }

  /** remove a body from collisions (it stays in the grid but is skipped) */
  kill(b) {
    b.alive = false;
  }
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Footprint builder for a PDF piece: shared outline polygons (PDF local units) mapped through the
 * piece's 2D matrix into world metres.
 * @param {{outer:number[][],holes:number[][][]}[]} outline
 * @param {number[]} m [a,b,c,d,e,f] local -> PDF points
 * @param {number} s metres per point
 */
export function pieceFootprint(outline, m, s) {
  const [a, b, c, d, e, f] = m;
  const map = (ring) => ring.map(([x, y]) => [s * (a * x + c * y + e), s * (b * x + d * y + f)]);
  return outline.map((p) => ({ outer: map(p.outer), holes: p.holes.map(map) }));
}
