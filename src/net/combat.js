// MP4: player vs player. The host is the referee for health, deaths, kills and respawns.
// Pure JS (no three.js, no DOM): tools/sim-pvp.mjs runs it against a lossy fake network.
//
//   - The shooter's screen decides that a bullet hit a player (what you see is what you hit) and
//     sends  {t:"pvp", v, h, d, p:[x,y,z], vt}  to the host (the host's own hits apply directly).
//   - The host sanity-checks it: shooter and victim alive, victim not spawn-protected, and the
//     victim really was near p at vt: the moment the shooter saw it, in host time. The host
//     keeps 2 s of position history per player for this rewind check.
//   - Damage: 25 body / 50 head, falling off linearly past 40 m to 60 % at 120 m+.
//   - Results go to everyone:  {t:"hurt", v, by, hp, h, s:[x,z]}  /  {t:"death", v, by, h}
//     and 3 s later  {t:"respawn", v, x, z, y, u}  (u = end of the 2 s spawn protection,
//     which also ends as soon as that player shoots).
//   - Health regenerates at 8 HP/s after 5 s without damage, on the host and (for display) on
//     each client with the same rule. Every hurt message carries the host's exact value.
//   - MP5: `enabled` is false between matches (no damage, no respawns). Guest hits carry the match
//     round `r`; the host drops hits fired in an earlier round (still in flight at a rematch).
//     Per player we also count the kill streak, best streak and headshot kills (end-of-match awards).

export const COMBAT = {
  maxHp: 100,
  body: 25,
  head: 50,
  falloffStart: 40, // m
  falloffEnd: 120, // m
  falloffMin: 0.6,
  regenDelay: 5, // s without damage
  regenRate: 8, // HP/s
  respawnDelay: 3, // s
  protection: 2, // s
  rewindTolerance: 1.2, // m: claimed hit point vs where the host thinks the victim was
};

/** damage of one bullet at `dist` metres */
export function damageFor(head, dist, c = COMBAT) {
  const base = head ? c.head : c.body;
  const k =
    dist <= c.falloffStart ? 1 : dist >= c.falloffEnd ? c.falloffMin : 1 - ((1 - c.falloffMin) * (dist - c.falloffStart)) / (c.falloffEnd - c.falloffStart);
  return Math.max(1, Math.round(base * k));
}

/** 2 s of positions for the host's rewind check */
class History {
  constructor() {
    this.s = [];
  }
  push(t, x, y, z, crouch) {
    const s = this.s;
    if (s.length && t <= s[s.length - 1].t) return;
    s.push({ t, x, y, z, crouch });
    while (s.length > 2 && s[0].t < t - 2000) s.shift();
  }
  at(t) {
    const s = this.s;
    if (!s.length) return null;
    if (t <= s[0].t) return s[0];
    for (let i = 1; i < s.length; i++) {
      if (s[i].t >= t) {
        const a = s[i - 1], b = s[i], u = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, crouch: u < 0.5 ? a.crouch : b.crouch };
      }
    }
    return s[s.length - 1];
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

export class Combat {
  /**
   * @param {object} o
   * @param {boolean} o.isHost
   * @param {() => number} o.selfId
   * @param {() => number} o.now                      shared (host) clock, ms
   * @param {(msg:any) => void} [o.toHost]           guest
   * @param {(msg:any) => void} [o.toAll]            host
   * @param {(id:number) => {x:number,z:number,yaw:number}} [o.spawnFor]   host: where to respawn a player
   * @param {object} o.fx  callbacks for the game:
   *   hurt(victim, by, hp, head, from:{x,z}|null)   died(victim, killer, head)   respawned(id, {x,z,yaw}, until)
   *   stats()   (kills / deaths changed)
   * @param {typeof COMBAT} [o.cfg]
   */
  constructor(o) {
    Object.assign(this, o);
    this.cfg ??= COMBAT;
    this.round ??= () => 0;
    /** false between matches: no damage, no respawns */
    this.enabled = true;
    /** @type {Map<number, {hp:number, alive:boolean, prot:number, lastHurt:number, kills:number, deaths:number, respawnAt:number}>} */
    this.players = new Map();
    /** @type {Map<number, History>} host: recent positions */
    this.hist = new Map();
    this.rejected = 0;
    /** host: why hits were refused (dead / protected targets are normal; "rewind" = implausible) */
    this.rejectedBy = { dead: 0, protected: 0, rewind: 0 };
    this.lastUpdate = null;
  }

  get(id) {
    return this.players.get(id);
  }

  /** keep the roster in line with the room's player list (new players start alive at full HP) */
  syncPlayers(ids) {
    const keep = new Set(ids);
    for (const id of ids) {
      if (!this.players.has(id)) this.players.set(id, fresh(this.cfg));
    }
    for (const id of [...this.players.keys()]) {
      if (!keep.has(id)) {
        this.players.delete(id);
        this.hist.delete(id);
      }
    }
  }

  /** host: a player's position at host time t (from its state messages, or our own player) */
  record(id, t, x, y, z, crouch) {
    let h = this.hist.get(id);
    if (!h) this.hist.set(id, (h = new History()));
    h.push(t, x, y, z, crouch);
  }

  /** a player fired: that ends their spawn protection (host decides; clients just mirror it) */
  firedBy(id) {
    const p = this.players.get(id);
    if (p && p.prot > this.now()) p.prot = 0;
  }

  isProtected(id) {
    const p = this.players.get(id);
    return !!p && p.prot > this.now();
  }

  // ------------------------------------------------------------------ our own bullet hit a player
  /**
   * @param {{victim:number, head:boolean, dist:number, point:{x:number,y:number,z:number}, viewTime:number}} h
   */
  localHit(h) {
    const self = this.selfId();
    if (!this.enabled) return;
    if (this.isHost) this._hostApply(self, h.victim, h.head, h.dist, h.point, h.viewTime, true);
    else this.toHost({ t: "pvp", r: this.round(), v: h.victim, h: h.head ? 1 : 0, d: r2(h.dist), p: [r2(h.point.x), r2(h.point.y), r2(h.point.z)], vt: Math.round(h.viewTime) });
  }

  // ------------------------------------------------------------------ network
  /** @returns {boolean} true if the message was ours */
  onMessage(msg, from) {
    if (this.isHost) {
      if (msg.t !== "pvp") return false;
      if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite) || !Number.isFinite(msg.d) || !Number.isFinite(msg.vt)) return true;
      if (msg.r !== undefined && msg.r !== this.round()) {
        this.rejected++;
        this.rejectedBy.round = (this.rejectedBy.round || 0) + 1;
        return true; // fired in a previous match
      }
      this._hostApply(from, msg.v, !!msg.h, msg.d, { x: msg.p[0], y: msg.p[1], z: msg.p[2] }, msg.vt, false);
      return true;
    }
    const now = this.now();
    if (msg.t === "hurt") {
      const p = this.players.get(msg.v);
      if (!p) return true;
      p.hp = msg.hp;
      p.lastHurt = now;
      this.fx.hurt(msg.v, msg.by, msg.hp, !!msg.h, msg.s ? { x: msg.s[0], z: msg.s[1] } : null);
      return true;
    }
    if (msg.t === "death") {
      const p = this.players.get(msg.v), k = this.players.get(msg.by);
      if (p) {
        p.hp = 0;
        p.alive = false;
      }
      tally(p, msg.by !== msg.v ? k : null, !!msg.h);
      this.fx.died(msg.v, msg.by, !!msg.h);
      this.fx.stats?.();
      return true;
    }
    if (msg.t === "respawn") {
      const p = this.players.get(msg.v);
      if (p) {
        p.hp = this.cfg.maxHp;
        p.alive = true;
        p.prot = msg.u;
        p.lastHurt = -1e9;
      }
      this.fx.respawned(msg.v, { x: msg.x, z: msg.z, yaw: msg.y }, msg.u);
      return true;
    }
    return false;
  }

  _hostApply(by, v, head, dist, point, viewTime, trusted) {
    if (!this.enabled) {
      this.rejected++;
      return;
    }
    const now = this.now();
    const shooter = this.players.get(by), victim = this.players.get(v);
    if (!shooter || !victim || v === by || !shooter.alive || !victim.alive || victim.prot > now) {
      this.rejected++;
      if (victim?.prot > now) this.rejectedBy.protected++;
      else this.rejectedBy.dead++;
      return;
    }
    if (!trusted) {
      // rewind: where was the victim when the shooter saw it? (allow up to 1 s of lag)
      const at = this.hist.get(v)?.at(Math.max(now - 1000, Math.min(now, viewTime)));
      if (at) {
        const top = at.y + (at.crouch ? 1.15 : 1.85);
        const dy = point.y < at.y ? at.y - point.y : point.y > top ? point.y - top : 0;
        const off = Math.hypot(point.x - at.x, point.z - at.z, dy);
        if (off > this.cfg.rewindTolerance + 0.35) {
          this.rejected++;
          this.rejectedBy.rewind++;
          return;
        }
      }
    }
    const dmg = damageFor(head, Math.max(0, dist), this.cfg);
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.lastHurt = now;
    const from = this.hist.get(by)?.at(now);
    if (victim.hp <= 0) {
      victim.alive = false;
      tally(victim, shooter, head);
      victim.respawnAt = now + this.cfg.respawnDelay * 1000;
      this.toAll({ t: "death", v, by, h: head ? 1 : 0 });
      this.fx.died(v, by, head);
      this.fx.stats?.();
    } else {
      const hp = Math.round(victim.hp * 10) / 10;
      const msg = { t: "hurt", v, by, hp, h: head ? 1 : 0, s: from ? [r2(from.x), r2(from.z)] : undefined };
      this.toAll(msg);
      this.fx.hurt(v, by, hp, head, from ? { x: from.x, z: from.z } : null);
    }
  }

  /** regen, and (host) respawns. Call every frame or from a timer. */
  update() {
    const now = this.now();
    const dt = this.lastUpdate === null ? 0 : Math.max(0, Math.min(1, (now - this.lastUpdate) / 1000));
    this.lastUpdate = now;
    const c = this.cfg;
    for (const [id, p] of this.players) {
      if (p.alive && p.hp < c.maxHp && now - p.lastHurt > c.regenDelay * 1000) p.hp = Math.min(c.maxHp, p.hp + c.regenRate * dt);
      if (this.isHost && this.enabled && !p.alive && p.respawnAt && now >= p.respawnAt) {
        const s = this.spawnFor(id);
        p.alive = true;
        p.hp = c.maxHp;
        p.lastHurt = -1e9;
        p.respawnAt = 0;
        p.prot = now + c.protection * 1000;
        this.toAll({ t: "respawn", v: id, x: r2(s.x), z: r2(s.z), y: r2(s.yaw), u: Math.round(p.prot) });
        this.fx.respawned(id, s, p.prot);
      }
    }
  }

  // ------------------------------------------------------------------ rematch (MP5)
  /**
   * New match: everyone alive at full HP, scores zeroed, spawn protection until `protUntil`.
   * (The respawn positions are the match module's business.)
   */
  resetRound(protUntil) {
    for (const p of this.players.values()) {
      Object.assign(p, fresh(this.cfg));
      p.prot = protUntil;
    }
    this.hist.clear();
    this.enabled = true;
    this.fx.stats?.();
  }

  // ------------------------------------------------------------------ reconnect (MP5)
  /** host: a guest dropped; keep its numbers so it can come back */
  exportStats(id) {
    const p = this.players.get(id);
    return p ? { kills: p.kills, deaths: p.deaths, streak: 0, best: p.best, heads: p.heads } : null;
  }

  /** host: the guest came back under the same id */
  importStats(id, s) {
    const p = this.players.get(id);
    if (!p || !s) return;
    Object.assign(p, { kills: s.kills, deaths: s.deaths, streak: 0, best: s.best, heads: s.heads });
    this.fx.stats?.();
  }

  // ------------------------------------------------------------------ late join
  snapshot() {
    return [...this.players].map(([id, p]) => [id, Math.round(p.hp * 10) / 10, p.alive ? 1 : 0, Math.round(p.prot), p.kills, p.deaths, p.streak, p.best, p.heads]);
  }

  applySnapshot(rows) {
    if (!Array.isArray(rows)) return;
    for (const [id, hp, alive, prot, kills, deaths, streak = 0, best = 0, heads = 0] of rows) {
      this.players.set(id, { ...fresh(this.cfg), hp, alive: !!alive, prot, lastHurt: this.now(), kills, deaths, streak, best, heads });
    }
    this.fx.stats?.();
  }
}

function fresh(c) {
  return { hp: c.maxHp, alive: true, prot: 0, lastHurt: -1e9, kills: 0, deaths: 0, respawnAt: 0, streak: 0, best: 0, heads: 0 };
}

/** bookkeeping for a death: victim's deaths, killer's kills / streak / headshot kills */
function tally(victim, killer, head) {
  if (victim) {
    victim.deaths++;
    victim.streak = 0;
  }
  if (killer && killer !== victim) {
    killer.kills++;
    killer.streak = (killer.streak || 0) + 1;
    killer.best = Math.max(killer.best || 0, killer.streak);
    if (head) killer.heads = (killer.heads || 0) + 1;
  }
}
