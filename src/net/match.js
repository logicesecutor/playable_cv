// MP5: the match. First to `target` kills wins; the host referees and starts rematches.
// Pure JS (no three.js, no DOM): tools/sim-match.mjs plays several matches over a laggy fake link.
//
//   host -> all  {t:"match", s:"end",   r, w, sc:[[id, kills, deaths, letters, heads, best]…], aw:[[key, id, value]…]}
//   host -> all  {t:"match", s:"start", r, u, sp:[[id, x, z, yaw]…]}     (u = end of spawn protection)
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
   * @param {(msg:any) => void} [o.toAll]   host
   * @param {{ended:(m:Match) => void, started:(m:Match) => void}} o.fx
   */
  constructor(o) {
    this.isHost = o.isHost;
    this.target = o.target ?? 10;
    this.toAll = o.toAll;
    this.fx = o.fx;
    this.phase = "playing"; // "playing" | "ended"
    this.round = 1;
    this.winner = null;
    /** final numbers, [[id, kills, deaths, letters, heads, best]…] */
    this.scores = [];
    /** [[key, id, value]…] */
    this.awards = [];
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
    const { winner, sorted, awards } = results(r);
    this.phase = "ended";
    this.winner = winner;
    this.scores = sorted.map((x) => [x.id, x.kills, x.deaths, x.letters, x.heads, x.best]);
    this.awards = awards;
    this.toAll({ t: "match", s: "end", r: this.round, w: winner, sc: this.scores, aw: awards });
    this.fx.ended(this);
    return true;
  }

  /**
   * Start the next match.
   * @param {[number, number, number, number][]} spawns [[id, x, z, yaw]…]
   * @param {number} protUntil host time
   */
  rematch(spawns, protUntil) {
    if (!this.isHost || this.playing) return;
    this.round++;
    this._start(spawns, protUntil);
    this.toAll({ t: "match", s: "start", r: this.round, u: Math.round(protUntil), sp: this.spawns });
  }

  // ------------------------------------------------------------------ guest
  /** @returns {boolean} true if the message was ours */
  onMessage(msg) {
    if (this.isHost || msg.t !== "match") return false;
    if (msg.s === "end") {
      this.phase = "ended";
      this.round = msg.r;
      this.winner = msg.w;
      this.scores = Array.isArray(msg.sc) ? msg.sc : [];
      this.awards = Array.isArray(msg.aw) ? msg.aw : [];
      this.fx.ended(this);
    } else if (msg.s === "start") {
      this.round = msg.r;
      this._start(Array.isArray(msg.sp) ? msg.sp : [], msg.u);
    }
    return true;
  }

  _start(spawns, protUntil) {
    this.phase = "playing";
    this.winner = null;
    this.scores = [];
    this.awards = [];
    this.spawns = spawns.map(([id, x, z, yaw]) => [id, Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(yaw * 100) / 100]);
    this.protUntil = protUntil;
    this.fx.started(this);
  }

  // ------------------------------------------------------------------ late join
  snapshot() {
    return { p: this.phase, r: this.round, t: this.target, w: this.winner, sc: this.scores, aw: this.awards };
  }

  applySnapshot(s) {
    if (!s) return;
    this.round = s.r ?? 1;
    this.target = s.t ?? this.target;
    if (s.p === "ended") {
      this.phase = "ended";
      this.winner = s.w;
      this.scores = s.sc || [];
      this.awards = s.aw || [];
      this.fx.ended(this);
    }
  }
}
