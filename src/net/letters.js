// MP3: shared destruction. Which letters are alive and how much HP they have is the same for every
// player; the host is the referee. Pure JS (no three.js, no DOM): tools/sim-net.mjs runs it
// against a lossy fake network.
//
//   - Everyone predicts their own shots: the hit effects play at once and, if the shot should kill
//     the letter, it shatters at once (Destruction.bullet does that, then calls localHit()).
//   - Guests batch their hits to the host every 50 ms:   {t:"hits", h:[[id, px,py,pz, nx,ny,nz, dx,dy,dz], …]}
//   - The host checks each hit (letter still alive? shooter close enough?), applies it to its own
//     map, which is the authoritative one, and batches the results to every guest:
//                                                        {t:"dmg",  e:[[type, id, by, hp, px,py,pz, a,b,c], …]}
//     type 0 = hit (a,b,c = surface normal), 1 = kill (a,b,c = bullet direction)
//   - A guest applies them: other players' hits play their effects; kills shatter the letter unless
//     it's already gone (our own predicted kill). HP only ever goes down to the host's value.
//   - A rejected hit comes back to its shooter as {t:"hitNo", id, hp}: a letter we predicted
//     dead comes back.
//   - Late join: the welcome carries snapshot() = destroyed ids + damaged HP + per-player counts.
//
// Every kill is counted for the player who landed it (letters destroyed per player).

export const HIT = 0, KILL = 1;
const FLUSH_MS = 50;
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * @typedef {{id:number, hp:number, alive:boolean}} Letter   (the game's entities have these fields)
 * @typedef {{x:number,y:number,z:number, nx:number,ny:number,nz:number}} HitPoint
 * @typedef {{
 *   hit:  (e:Letter, h:HitPoint) => void,                    effects for someone else's hit
 *   kill: (e:Letter, h:HitPoint, dir:{x:number,y:number,z:number}) => void,   shatter (must set alive=false)
 *   silentKill: (e:Letter) => void,                          late-join: gone, no effects (must set alive=false)
 *   revive: (e:Letter) => void,                              undo a predicted kill (must set alive=true)
 * }} LetterFx
 */

export class LetterNet {
  /**
   * @param {object} o
   * @param {Letter[]} o.entities        indexed by id
   * @param {boolean} o.isHost
   * @param {() => number} o.selfId
   * @param {LetterFx} o.fx
   * @param {(msg:any) => void} o.toHost           guest: reliable message to the host
   * @param {(msg:any) => void} o.toAll            host: reliable message to every guest
   * @param {(id:number, msg:any) => void} o.toOne host: reliable message to one guest
   * @param {(playerId:number) => ({x:number,z:number}|null)} [o.shooterPos] host: last known position
   * @param {number} [o.maxDist=420] host: a hit further than this from its shooter is rejected
   */
  constructor(o) {
    Object.assign(this, o);
    this.maxDist ??= 420;
    this.round ??= () => 0; // MP5: hits fired in an earlier match are dropped by the host
    this.outHits = []; // guest: hits waiting for the next flush
    this.outEvents = []; // host: results waiting for the next flush
    this.flushT = 0;
    /** @type {Map<number, number>} player id -> letters destroyed */
    this.kills = new Map();
    /** called when the per-player counts change */
    this.onStats = null;
    this.rejected = 0;
  }

  // ------------------------------------------------------------------ our own shot
  /**
   * We shot letter `e` and already applied it locally (effects, hp - 1, shatter if hp <= 0).
   * @param {Letter} e @param {HitPoint} h @param {{x:number,y:number,z:number}} dir
   */
  localHit(e, h, dir) {
    if (this.isHost) {
      // the host's map is the truth: just tell everyone
      const killed = !e.alive;
      if (killed) this._count(this.selfId());
      this.outEvents.push(killed ? killEv(e.id, this.selfId(), h, dir) : hitEv(e.id, this.selfId(), e.hp, h));
    } else {
      this.outHits.push([e.id, r2(h.x), r2(h.y), r2(h.z), r2(h.nx), r2(h.ny), r2(h.nz), r2(dir.x), r2(dir.y), r2(dir.z)]);
    }
  }

  // ------------------------------------------------------------------ network
  /** @returns {boolean} true if the message was ours */
  onMessage(msg, fromId) {
    if (this.isHost && msg.t === "hits" && Array.isArray(msg.h)) {
      if (msg.r !== undefined && msg.r !== this.round()) return true; // from a previous match
      for (const h of msg.h) this._hostApply(h, fromId);
      return true;
    }
    if (!this.isHost && msg.t === "dmg" && Array.isArray(msg.e)) {
      for (const ev of msg.e) this._guestApply(ev);
      return true;
    }
    if (!this.isHost && msg.t === "hitNo") {
      const e = this.entities[msg.id];
      if (!e) return true;
      this.rejected++;
      e.hp = msg.hp;
      if (!e.alive && msg.hp > 0) this.fx.revive(e);
      return true;
    }
    return false;
  }

  /** host: a guest's hit */
  _hostApply(h, by) {
    if (!Array.isArray(h) || h.length < 10 || !h.every(Number.isFinite)) return;
    const [id, x, y, z, nx, ny, nz, dx, dy, dz] = h;
    const e = this.entities[id];
    if (!e) return;
    if (!e.alive) return; // someone else got it first; the kill already went out
    const p = this.shooterPos?.(by);
    if (p && Math.hypot(x - p.x, z - p.z) > this.maxDist) {
      this.toOne(by, { t: "hitNo", id, hp: e.hp });
      this.rejected++;
      return;
    }
    const hp = { x, y, z, nx, ny, nz };
    e.hp -= 1;
    if (e.hp <= 0) {
      this.fx.kill(e, hp, { x: dx, y: dy, z: dz });
      this._count(by);
      this.outEvents.push(killEv(id, by, hp, { x: dx, y: dy, z: dz }));
    } else {
      this.fx.hit(e, hp);
      this.outEvents.push(hitEv(id, by, e.hp, hp));
    }
  }

  /** guest: a result from the host */
  _guestApply(ev) {
    if (!Array.isArray(ev) || ev.length < 10) return;
    const [type, id, by, hp, x, y, z, a, b, c] = ev;
    const e = this.entities[id];
    if (!e) return;
    const mine = by === this.selfId();
    if (type === KILL) {
      this._count(by);
      if (e.alive) this.fx.kill(e, { x, y, z, nx: 0, ny: 1, nz: 0 }, { x: a, y: b, z: c });
      e.hp = Math.min(e.hp, 0);
    } else {
      e.hp = Math.min(e.hp, hp); // never above what we predicted ourselves (our hits may be in flight)
      if (!mine && e.alive) this.fx.hit(e, { x, y, z, nx: a, ny: b, nz: c });
    }
  }

  _count(by) {
    this.kills.set(by, (this.kills.get(by) || 0) + 1);
    this.onStats?.(this.kills);
  }

  /** send what accumulated (call every frame; it sends at most every 50 ms) */
  update(dtMs) {
    this.flushT -= dtMs;
    if (this.flushT > 0) return;
    this.flushT = FLUSH_MS;
    if (this.outHits.length) {
      this.toHost({ t: "hits", r: this.round(), h: this.outHits });
      this.outHits = [];
    }
    if (this.outEvents.length) {
      this.toAll({ t: "dmg", e: this.outEvents });
      this.outEvents = [];
    }
  }

  /** rematch: forget everything (the game restores the letters themselves) */
  reset() {
    this.outHits = [];
    this.outEvents = [];
    this.kills = new Map();
    this.onStats?.(this.kills);
  }

  // ------------------------------------------------------------------ late join
  /** host: everything a new guest needs to catch up (call right before the welcome) */
  snapshot() {
    this.update(Infinity); // anything pending goes out first, so the snapshot + later events line up
    const dead = [], hp = [];
    for (const e of this.entities) {
      if (!e.alive) dead.push(e.id);
      else if (e.hp < e.maxHp) hp.push([e.id, e.hp]);
    }
    return { dead, hp, kills: [...this.kills] };
  }

  /** guest: apply the host's snapshot before playing */
  applySnapshot(s) {
    if (!s) return;
    for (const id of s.dead || []) {
      const e = this.entities[id];
      if (e?.alive) this.fx.silentKill(e);
    }
    for (const [id, hp] of s.hp || []) {
      const e = this.entities[id];
      if (e) e.hp = Math.min(e.hp, hp);
    }
    this.kills = new Map(s.kills || []);
    this.onStats?.(this.kills);
  }
}

function hitEv(id, by, hp, h) {
  return [HIT, id, by, hp, r2(h.x), r2(h.y), r2(h.z), r2(h.nx), r2(h.ny), r2(h.nz)];
}
function killEv(id, by, h, d) {
  return [KILL, id, by, 0, r2(h.x), r2(h.y), r2(h.z), r2(d.x), r2(d.y), r2(d.z)];
}
