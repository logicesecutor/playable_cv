// Remote player motion: a buffer of time-stamped snapshots, rendered a little in the past so there
// is (almost) always a snapshot on each side of the render time to interpolate between.
//
// Over the internet packets arrive late, out of order or not at all. This handles it by:
//   - adaptive delay: render at  now - delay,  where delay follows the measured lateness + jitter
//     of arriving snapshots (grows fast when the connection gets worse, shrinks slowly)
//   - cubic Hermite interpolation using the sent velocities (smooth curves, no corner cutting)
//   - extrapolation along the last velocity for up to `extrapolate` ms when packets go missing,
//     then hold still
//   - no interpolation across a jump of more than `snapDist` metres (respawn / teleport)
//
// Pure JS (no three.js, no DOM): tools/test-interp.mjs simulates bad networks against it.

/** @typedef {{t:number, k:number, x:number, y:number, z:number, yaw:number, pitch:number, vx:number, vy:number, vz:number, f:number}} Snapshot */

export const FLAG = { crouch: 1, grounded: 2, sprint: 4, fly: 8 };

export class SnapshotBuffer {
  /**
   * @param {object} [o]
   * @param {number} [o.interval=50] ms between snapshots the sender sends
   * @param {number} [o.minDelay=60]
   * @param {number} [o.maxDelay=400]
   * @param {number} [o.extrapolate=250] ms
   * @param {number} [o.snapDist=4] m
   */
  constructor(o = {}) {
    this.interval = o.interval ?? 50;
    this.minDelay = o.minDelay ?? 60;
    this.maxDelay = o.maxDelay ?? 400;
    this.extrapolateMs = o.extrapolate ?? 250;
    this.snapDist = o.snapDist ?? 4;
    /** @type {Snapshot[]} sorted by t */
    this.list = [];
    this.delay = this.interval * 2;
    this.lateMean = 0; // how late snapshots arrive vs their stamp (ms, EWMA)
    this.lateDev = 0; // jitter: EWMA of |lateness - mean|
    this.count = 0;
    this.lastSampleAt = null;
    this.lastK = -1;
  }

  /** @param {Snapshot} s  @param {number} arrival host-clock ms when it arrived */
  push(s, arrival) {
    const late = arrival - s.t;
    // the sender's clock moved a lot (it re-synced): start over
    if (late < -1000 || late > 5000) this.reset();
    if (this.count === 0) {
      this.lateMean = late;
      this.lateDev = this.interval * 0.25;
    } else {
      this.lateDev += (Math.abs(late - this.lateMean) - this.lateDev) * 0.1;
      this.lateMean += (late - this.lateMean) * 0.1;
    }
    this.count++;
    if (s.k > this.lastK) this.lastK = s.k;

    // insert in time order, ignore duplicates
    const L = this.list;
    let i = L.length;
    while (i > 0 && L[i - 1].t > s.t) i--;
    if (i > 0 && L[i - 1].t === s.t) return;
    L.splice(i, 0, s);
    if (L.length > 64) L.splice(0, L.length - 64);
  }

  reset() {
    this.list.length = 0;
    this.count = 0;
    this.lastSampleAt = null;
  }

  get latest() {
    return this.list[this.list.length - 1] || null;
  }

  /** delay the buffer is aiming for, from measured lateness and jitter */
  targetDelay() {
    const t = this.lateMean + this.interval + 2.5 * this.lateDev + 10;
    return Math.min(this.maxDelay, Math.max(this.minDelay, t));
  }

  /**
   * State at host time `now - delay`.
   * @param {number} now host-clock ms
   * @param {object} out filled with x,y,z,yaw,pitch,vx,vy,vz,f and mode ("interp"|"extrap"|"hold"|"none")
   */
  sample(now, out = {}) {
    const L = this.list;
    if (!L.length) {
      out.mode = "none";
      return out;
    }
    // adapt the delay smoothly: catch up quickly when we're starving, relax slowly
    const dt = this.lastSampleAt === null ? 0 : Math.max(0, Math.min(0.25, (now - this.lastSampleAt) / 1000));
    this.lastSampleAt = now;
    const target = this.targetDelay();
    if (this.count < 3) this.delay = target;
    else this.delay += (target - this.delay) * Math.min(1, dt * (target > this.delay ? 2 : 0.4));

    const rt = now - this.delay;

    // drop what's too old, keeping one snapshot before the render time
    let first = 0;
    while (first < L.length - 2 && L[first + 1].t <= rt) first++;
    if (first > 0) L.splice(0, first);

    const a = L[0];
    if (rt <= a.t) return copy(out, a, "hold");

    for (let i = 0; i < L.length - 1; i++) {
      const s0 = L[i], s1 = L[i + 1];
      if (rt < s0.t || rt > s1.t) continue;
      const span = s1.t - s0.t;
      if (Math.hypot(s1.x - s0.x, s1.z - s0.z) > this.snapDist || span <= 0) return copy(out, s0, "interp");
      const u = (rt - s0.t) / span;
      const h = span / 1000; // seconds: velocities are m/s
      out.x = hermite(s0.x, s0.vx * h, s1.x, s1.vx * h, u);
      out.y = Math.max(0, hermite(s0.y, s0.vy * h, s1.y, s1.vy * h, u));
      out.z = hermite(s0.z, s0.vz * h, s1.z, s1.vz * h, u);
      out.vx = s0.vx + (s1.vx - s0.vx) * u;
      out.vy = s0.vy + (s1.vy - s0.vy) * u;
      out.vz = s0.vz + (s1.vz - s0.vz) * u;
      out.yaw = lerpAngle(s0.yaw, s1.yaw, u);
      out.pitch = s0.pitch + (s1.pitch - s0.pitch) * u;
      out.f = u < 0.5 ? s0.f : s1.f;
      out.mode = "interp";
      return out;
    }

    // past the newest snapshot: keep going along its velocity for a little while
    const b = L[L.length - 1];
    const ahead = Math.min(rt - b.t, this.extrapolateMs) / 1000;
    copy(out, b, rt - b.t <= this.extrapolateMs ? "extrap" : "hold");
    out.x += b.vx * ahead;
    out.z += b.vz * ahead;
    out.y = Math.max(0, b.y + (b.f & FLAG.grounded ? 0 : b.vy * ahead));
    return out;
  }
}

function copy(out, s, mode) {
  out.x = s.x; out.y = s.y; out.z = s.z;
  out.vx = s.vx; out.vy = s.vy; out.vz = s.vz;
  out.yaw = s.yaw; out.pitch = s.pitch; out.f = s.f;
  out.mode = mode;
  return out;
}

/** cubic Hermite between p0 and p1 with tangents m0, m1 (already scaled by the interval) */
function hermite(p0, m0, p1, m1, u) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

export function lerpAngle(a, b, u) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

// ---------------------------------------------------------------- wire format
// Compact JSON for the fast channel: ~80 bytes per state.
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * local player -> message
 * @param {number[][]} [shots] shots fired since the last state: [ox,oy,oz, ex,ey,ez, kind]
 */
export function encodeState(id, k, t, core, flags, shots) {
  const m = {
    t: "s",
    i: id,
    k,
    h: Math.round(t),
    p: [r2(core.x), r2(core.y), r2(core.z)],
    a: [r3(wrapAngle(core.yaw)), r3(core.pitch)],
    v: [r2(core.vx), r2(core.vy), r2(core.vz)],
    f: flags,
  };
  if (shots?.length) m.x = shots;
  return m;
}

/** shots carried by a state message, validated */
export function decodeShots(m) {
  if (!Array.isArray(m?.x)) return [];
  return m.x.filter((s) => Array.isArray(s) && s.length === 7 && s.every(Number.isFinite)).slice(0, 12);
}

/** message -> Snapshot, or null if malformed */
export function decodeState(m) {
  if (!m || !Array.isArray(m.p) || !Array.isArray(m.a) || !Array.isArray(m.v)) return null;
  const n = [...m.p, ...m.a, ...m.v, m.h, m.k];
  if (n.length !== 10 || !n.every(Number.isFinite)) return null;
  return { t: m.h, k: m.k, x: m.p[0], y: m.p[1], z: m.p[2], yaw: m.a[0], pitch: m.a[1], vx: m.v[0], vy: m.v[1], vz: m.v[2], f: m.f | 0 };
}

function wrapAngle(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
