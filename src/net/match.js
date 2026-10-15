// MP5: the match. First to `target` kills wins; the host referees and starts rematches.
// Pure JS (no three.js, no DOM): tools/sim-match.mjs plays several matches over a laggy fake link.
//
//   host -> all  {t:"match", s:"end",   r, w, sc:[[id, kills, deaths, letters, heads, best]…], aw:[[key, id, value]…], why}
//                (why: "kills" = someone reached the target, "shred" = the shredder ate the whole page
//                 first: the leader wins)
//   host -> all  {t:"match", s:"start", r, u, at, sh, sp:[[id, x, z, yaw]…]} (u = end of spawn protection)
//   host -> all  {t:"match", s:"go",    r, at, sh}
//
// The match clock: `at` is the host time (ms, room.now()) the match clock started. A rematch
// starts it at once; the first match starts when the host opens the room (game/pvp.js, S8: the
// shredder doesn't wait for guests). Until go() startAt is null. Timed events (the office's
// shredder, game/shredder.js) run off this clock, so every screen agrees on when they happen.
// `sh` = [after, seconds]: the host's shredder timings, so a host's dev override counts for all.
//
// `r` is the round number. Everything a guest sends that could change the score carries it (see
// combat.js and letters.js), so hits still in flight when a rematch starts can't leak into it.
// Messages go over the reliable, ordered channel: a guest always sees the last kill before the end.

export const AWARDS = [
  { key: "letters", title: "Demolition", unit: "letters destroyed" },
  { key: "best", title: "On a roll", unit: "kill streak" },
  { key: "heads", title: "Sharpshooter", unit: "headshots" },
];

/**
 * Winner + awards from the final numbers.
 * @param {{id:number, kills:number, deaths:number, letters:number, heads:number, best:number}[]} rows
 */
export function results(rows) {
  const sorted = [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  const awards = [];
  for (const a of AWARDS) {
    let best = null;
    for (const r of sorted) if (r[a.key] > 0 && (!best || r[a.key] > best[a.key])) best = r;
    if (best) awards.push([a.key, best.id, best[a.key]]);
  }
  return { winner: sorted[0]?.id ?? null, sorted, awards };
}

export class Match {
  /**
   * @param {object} o
   * @param {boolean} o.isHost
   * @param {number} [o.target=10]
   * @param {{after:number, seconds:number}} [o.shred]  host: the shredder's timings
   * @param {(msg:any) => void} [o.toAll]   host
   * @param {{ended:(m:Match) => void, started:(m:Match) => void, clock?:(m:Match) => void}} o.fx
   *   `clock`: startAt changed (the match clock started, or a new match began)
   */
  constructor(o) {
    this.isHost = o.isHost;
    this.target = o.target ?? 10;
    /** the shredder's timings, the host's (guests get them with the clock) */
    this.shred = o.shred ?? null;
    this.toAll = o.toAll;
    this.fx = o.fx;
    this.phase = "playing"; // "playing" | "ended"
    this.round = 1;
    this.winner = null;
    /** final numbers, [[id, kills, deaths, letters, heads, best]…] */
    this.scores = [];
    /** [[key, id, value]…] */
    this.awards = [];
    /** how the last match ended: "kills" | "shred" */
    this.why = "kills";
    /** host time (ms) the match clock started; null = waiting for the first guest */
    this.startAt = null;
  }

  /**
   * Seconds since the match clock started (null before it starts).
   * @param {number} now host time (ms)
   */
  elapsed(now) {
    return this.startAt == null ? null : (now - this.startAt) / 1000;
  }

  get playing() {
    return this.phase === "playing";
  }

  // ------------------------------------------------------------------ host
  /**
   * After every kill: has someone reached the target?
   * @param {() => {id:number, kills:number, deaths:number, letters:number, heads:number, best:number}[]} rows
   */
  check(rows) {
    if (!this.isHost || !this.playing) return false;
    const r = rows();
    if (!r.some((x) => x.kills >= this.target)) return false;
    return this._end(r, "kills");
  }

  /**
   * End the match now, whatever the score (the shredder ate the page): the leader wins.
   * @param {() => {id:number, kills:number, deaths:number, letters:number, heads:number, best:number}[]} rows
   * @param {string} why
   */
  finish(rows, why) {
    if (!this.isHost || !this.playing) return false;
    return this._end(rows(), why);
  }

  _end(r, why) {
    const { winner, sorted, awards } = results(r);
    this.phase = "ended";
    this.winner = winner;
    this.why = why;
    this.scores = sorted.map((x) => [x.id, x.kills, x.deaths, x.letters, x.heads, x.best]);
    this.awards = awards;
    this.toAll({ t: "match", s: "end", r: this.round, w: winner, sc: this.scores, aw: awards, why });
    this.fx.ended(this);
    return true;
  }

  /**
   * Start the match clock if it isn't running yet (the first guest is in the game).
   * @param {number} at host time (ms)
   * @returns {boolean} true if it started now
   */
  go(at) {
    if (!this.isHost || !this.playing || this.startAt != null) return false;
    this.startAt = Math.round(at);
    this.toAll({ t: "match", s: "go", r: this.round, at: this.startAt, sh: this._sh() });
    this.fx.clock?.(this);
    return true;
  }

  /**
   * Start the next match.
   * @param {[number, number, number, number][]} spawns [[id, x, z, yaw]…]
   * @param {number} protUntil host time
   * @param {number} [at=protUntil] host time the match clock starts
   */
  rematch(spawns, protUntil, at = protUntil) {
    if (!this.isHost || this.playing) return;
    this.round++;
    this._start(spawns, protUntil, Math.round(at));
    this.toAll({ t: "match", s: "start", r: this.round, u: Math.round(protUntil), at: this.startAt, sh: this._sh(), sp: this.spawns });
  }

  _sh() {
    return this.shred ? [this.shred.after, this.shred.seconds] : undefined;
  }

  _takeSh(sh) {
    if (Array.isArray(sh) && sh.length === 2 && sh.every((v) => Number.isFinite(v) && v >= 0)) this.shred = { after: sh[0], seconds: sh[1] };
  }

  // ------------------------------------------------------------------ guest
  /** @returns {boolean} true if the message was ours */
  onMessage(msg) {
    if (this.isHost || msg.t !== "match") return false;
    this._takeSh(msg.sh);
    if (msg.s === "end") {
      this.phase = "ended";
      this.round = msg.r;
      this.winner = msg.w;
      this.scores = Array.isArray(msg.sc) ? msg.sc : [];
      this.awards = Array.isArray(msg.aw) ? msg.aw : [];
      this.why = msg.why === "shred" ? "shred" : "kills";
      this.fx.ended(this);
    } else if (msg.s === "start") {
      this.round = msg.r;
      this._start(Array.isArray(msg.sp) ? msg.sp : [], msg.u, Number.isFinite(msg.at) ? msg.at : null);
    } else if (msg.s === "go") {
      if (msg.r === this.round && this.playing && Number.isFinite(msg.at)) {
        this.startAt = msg.at;
        this.fx.clock?.(this);
      }
    }
    return true;
  }

  _start(spawns, protUntil, at = null) {
    this.phase = "playing";
    this.startAt = at;
    this.winner = null;
    this.scores = [];
    this.awards = [];
    this.spawns = spawns.map(([id, x, z, yaw]) => [id, Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(yaw * 100) / 100]);
    this.protUntil = protUntil;
    this.fx.started(this);
    this.fx.clock?.(this);
  }

  // ------------------------------------------------------------------ late join
  snapshot() {
    return { p: this.phase, r: this.round, t: this.target, w: this.winner, sc: this.scores, aw: this.awards, at: this.startAt, sh: this._sh(), why: this.why };
  }

  applySnapshot(s) {
    if (!s) return;
    this.round = s.r ?? 1;
    this.target = s.t ?? this.target;
    this.startAt = Number.isFinite(s.at) ? s.at : null;
    this._takeSh(s.sh);
    if (s.p === "ended") {
      this.phase = "ended";
      this.winner = s.w;
      this.scores = s.sc || [];
      this.awards = s.aw || [];
      this.why = s.why === "shred" ? "shred" : "kills";
      this.fx.ended(this);
    } else this.fx.clock?.(this);
  }
}
