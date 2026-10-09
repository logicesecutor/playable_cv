// Player hitboxes: a vertical capsule for the body and a sphere for the head, sized like the
// chibi characters (public/models/player_*.glb; and like the first-person player: eyes at
// 1.65 m standing, 0.95 m crouched). The big chibi head gets a big head sphere: what you see is
// what you hit. Pure math, no three.js.

export const HITBOX = {
  radius: 0.35, // body capsule radius (= player collision radius)
  bodyTop: 1.32, // standing: top of the body capsule (shoulders, where the big head starts)
  bodyTopCrouch: 0.72,
  eye: 1.65,
  eyeCrouch: 0.95,
  headRadius: 0.29, // the head is ~0.62 m tall (was 0.17 for the box soldier)
};

/** hitbox shape for a player whose feet are at (x, y, z); crouch 0..1 */
export function hitboxOf(x, y, z, crouch = 0, h = HITBOX) {
  const eye = h.eye + (h.eyeCrouch - h.eye) * crouch;
  const top = h.bodyTop + (h.bodyTopCrouch - h.bodyTop) * crouch;
  return {
    x, z,
    y0: y + h.radius, // capsule axis: the caps reach exactly from the feet to the shoulders
    y1: Math.max(y + h.radius, y + top - h.radius),
    r: h.radius,
    hx: x, hy: y + eye - 0.03, hz: z,
    hr: h.headRadius,
  };
}

/** ray (o + t d, d normalised) vs sphere; returns t or -1 */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? 0 : -1; // starting inside counts as a hit at 0
}

/** ray vs vertical capsule (axis from y0 to y1 at x, z, radius r); returns t or -1 */
export function rayCapsule(ox, oy, oz, dx, dy, dz, x, z, y0, y1, r) {
  let best = -1;
  // infinite cylinder, then clip to [y0, y1]
  const px = ox - x, pz = oz - z;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  // end caps
  for (const cy of [y0, y1]) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, x, cy, z, r);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/**
 * Nearest player hit by a ray, or null.
 * @param {{id:number, box:ReturnType<typeof hitboxOf>}[]} targets
 */
export function rayPlayers(targets, ox, oy, oz, dx, dy, dz, maxT) {
  let hit = null;
  for (const { id, box } of targets) {
    const th = raySphere(ox, oy, oz, dx, dy, dz, box.hx, box.hy, box.hz, box.hr);
    const tb = rayCapsule(ox, oy, oz, dx, dy, dz, box.x, box.z, box.y0, box.y1, box.r);
    let t = -1, head = false;
    if (th >= 0 && (tb < 0 || th <= tb)) { t = th; head = true; }
    else if (tb >= 0) t = tb;
    if (t >= 0 && t < maxT && (!hit || t < hit.t)) hit = { t, id, head, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
  }
  return hit;
}
