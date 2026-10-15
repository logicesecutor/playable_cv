// The shredder's timetable in a multiplayer match. Every screen works the same state out of the
// shared match clock (net/match.js: startAt, in host time), so the shredding itself never goes
// over the network: a late joiner or a reconnecting player simply computes where it has got to.
//
//   waiting  (countdown for the last `warn` seconds)
//   grab     she reaches for the CV, lifts it, reads it, turns to the shredder (`grab` seconds,
//            her Shred clip in office.glb: the CV reaches the slot at 9.33 s)
//   feeding  the shredder eats the page from its top edge (z = 0) down to the bottom (z = D) in
//            `seconds`; cutZ is where the cut is: everything with z < cutZ is gone
//   done     the page is used up (the host ends the match: the leader wins)
//
// What the cut does (S4): letters whose middle is above it are gone (PageEater, on every screen
// from the same clock), the paper there stops catching bullets (CollisionWorld.cutZ), nobody
// respawns near it (spawnClear) and the host kills anyone standing above it (game/pvp.js).
//
// Pure JS (no three.js, no DOM): tools/sim-shred.mjs tests it.

/** real metres -> game metres (1 PDF point = cfg.metersPerPt game metres) */
export const gameMetres = (cfg) => cfg.metersPerPt / (0.0254 / 72);

/**
 * Where the cut is for a feed progress. `bite`: game metres of the page already in the slot when
 * feeding starts (the CV goes in a centimetre deep), so the cut starts there, not at 0.
 * @param {number} progress 0..1
 * @param {number} D page depth (game metres)
 * @param {number} bite game metres
 */
export function cutAt(progress, D, bite) {
  return bite + Math.max(0, Math.min(1, progress)) * (D - bite);
}

/** how far below the cut a respawn must be (game metres): the cut moves ~5.4 m/s at 45 s */
export const SPAWN_LEAD = 30;

/** a spawn spot is fine if it is well below the cut */
export const spawnClear = (z, cutZ) => cutZ <= 0 || z > cutZ + SPAWN_LEAD;

/**
 * Eats the letters as the cut moves down the page: each letter goes once the cut passes its
 * middle. Sorted once, so a frame only looks at the letters the cut just passed. A smaller cutZ
 * (a rematch) starts over: the world reset has already brought the letters back.
 */
export class PageEater {
  /**
   * @param {{box:{minZ:number,maxZ:number}}[]} entities
   * @param {(e:any) => void} kill  remove a letter (no score, no network: every screen does it)
   */
  constructor(entities, kill) {
    this.list = [...entities].sort((a, b) => mid(a) - mid(b));
    this.kill = kill;
    this.next = 0;
    this.cutZ = 0;
  }

  /** @returns {number} letters eaten this call */
  update(cutZ) {
    if (cutZ < this.cutZ) this.next = 0;
    this.cutZ = cutZ;
    let n = 0;
    while (this.next < this.list.length && mid(this.list[this.next]) < cutZ) {
      this.kill(this.list[this.next++]);
      n++;
    }
    return n;
  }
}
const mid = (e) => (e.box.minZ + e.box.maxZ) / 2;

/**
 * @param {number|null} elapsed match seconds (null: the match clock hasn't started)
 * @param {{after:number, grab:number, seconds:number, warn:number}} o  timings (s)
 * @param {number} D page depth (game metres)
 * @param {number} bite game metres (see cutAt)
 * @returns {{phase:"waiting"|"grab"|"feeding"|"done", t:number|null, progress:number, cutZ:number, countdown:number|null}}
 *   t: seconds since she started reaching (null / negative before); countdown: seconds left
 *   before she reaches, during the last `warn` seconds only
 */
export function shredState(elapsed, o, D, bite) {
  if (elapsed == null || !Number.isFinite(elapsed)) return { phase: "waiting", t: null, progress: 0, cutZ: 0, countdown: null };
  const t = elapsed - o.after;
  if (t < 0) return { phase: "waiting", t, progress: 0, cutZ: 0, countdown: -t <= o.warn ? -t : null };
  const feed = t - o.grab;
  if (feed < 0) return { phase: "grab", t, progress: 0, cutZ: 0, countdown: null };
  const progress = Math.min(1, feed / Math.max(0.001, o.seconds));
  return { phase: progress >= 1 ? "done" : "feeding", t, progress, cutZ: cutAt(progress, D, bite), countdown: null };
}
