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
