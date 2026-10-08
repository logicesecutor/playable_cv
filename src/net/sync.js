// MP2: everyone sees everyone. Glue between a room (HostRoom / GuestRoom) and the game:
//
//   - sends our own player state 20x/s on the fast channel, stamped with the shared (host) clock
//   - the host relays each guest's state to the other guests (star topology: guests only ever
//     talk to the host)
//   - every other player gets a SnapshotBuffer (smooth motion over bad networks), an Avatar,
//     a name tag, footsteps and a minimap dot
//   - fair visibility: name tag + minimap dot only while that player is in view and not hidden
//     behind letters (line of sight through the collision grid)
//   - soft push: our own body slides off other players
import * as THREE from "three";
import { SnapshotBuffer, FLAG, encodeState, decodeState, decodeShots } from "./snapshots.js";
import { Avatar } from "../player/avatar.js";
import { hitboxOf, rayPlayers } from "./hitbox.js";

const SEND_INTERVAL = 50; // ms (20 Hz)
const VIS_INTERVAL = 0.1; // s between line-of-sight checks
const STALE_MS = 2500; // no state for this long: show the player as lagging

class RemotePlayer {
  constructor(info, scene) {
    this.id = info.id;
    this.info = info;
    this.buffer = new SnapshotBuffer({ interval: SEND_INTERVAL });
    this.avatar = new Avatar(info.color);
    this.avatar.root.visible = false;
    scene.add(this.avatar.root);
    this.s = {}; // sampled network state
    this.pos = new THREE.Vector3(); // displayed position (feet)
    this.has = false; // received at least one state
    this.lastArrival = 0;
    this.visible = false; // in view and in line of sight
    this.stepDist = 0;
    this.prev = new THREE.Vector3();
    this.shots = []; // {t, s}: their shots, played back in step with their (delayed) avatar
    this.seenShots = new Set(); // shot sequence numbers already queued (each shot is sent twice)
    this.revealUntil = 0; // shown on the minimap after shooting, even out of sight
    this.dead = false;
  }
}

export class NetSync {
  /**
   * @param {object} o
   * @param {import("./room.js").HostRoom | import("./room.js").GuestRoom} o.room
   * @param {THREE.Scene} o.scene
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {import("../world/collision.js").CollisionWorld} o.collision
   * @param {import("../player/playerController.js").PlayerController} o.player
   * @param {import("../audio/sfx.js").Sfx} o.sfx
   * @param {import("../ui/nameTags.js").NameTags} o.tags
   * @param {typeof import("../config.js").config} o.cfg
   */
  constructor(o) {
    Object.assign(this, o);
    /** @type {Map<number, RemotePlayer>} */
    this.remotes = new Map();
    this.k = 0; // our state counter
    this.sendT = 0;
    this.visT = 0;
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._pts = [new THREE.Vector3(), new THREE.Vector3()];
    this._anchor = new THREE.Vector3();
    this.stats = { sent: 0, received: 0 };
    // our recent shots: each one rides in two consecutive state messages, so a single lost packet
    // on the unreliable channel doesn't make a gunshot vanish (the receiver drops the duplicate)
    this.outShots = []; // {s:[…, seq], sends}
    this.shotSeq = 0;
    // hooks for the game (MP4)
    /** @type {(id:number, shot:number[]) => void} play someone's shot (tracer, sound, impact) */
    this.onRemoteShot = null;
    /** @type {(id:number, snap:any) => void} a state arrived (host: rewind history) */
    this.onState = null;
    /** @type {(id:number) => void} host: this player fired (ends spawn protection) */
    this.onFired = null;
    this.setPlayers(o.room.players);
  }

  /** the room's player list changed: add / remove remote players */
  setPlayers(players) {
    const keep = new Set();
    for (const p of players) {
      if (p.id === this.room.selfId || p.state !== "in-game") continue;
      keep.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        r = new RemotePlayer(p, this.scene);
        this.remotes.set(p.id, r);
      }
      r.info = p;
      this.tags.ensure(p.id, p.name, p.color);
    }
    for (const [id, r] of this.remotes) {
      if (keep.has(id)) continue;
      r.avatar.dispose();
      this.tags.remove(id);
      this.remotes.delete(id);
    }
  }

  /** a fast-channel message (already filtered to in-game players by the room) */
  onFast(msg, fromId) {
    if (msg.t !== "s") return;
    if (this.room.isHost) {
      msg.i = fromId; // a guest can only speak for itself
      this.room.broadcastFast(msg, fromId); // relay to the other guests
    }
    const r = this.remotes.get(msg.i);
    const snap = decodeState(msg);
    if (!r || !snap) return;
    const now = this.room.now();
    r.buffer.push(snap, now);
    r.lastArrival = now;
    this.stats.received++;
    this.onState?.(msg.i, snap);
    const shots = decodeShots(msg);
    if (shots.length) {
      this.onFired?.(msg.i);
      for (const s of shots) {
        const seq = s[7];
        if (seq !== undefined) {
          if (r.seenShots.has(seq)) continue; // the second copy of a shot we already have
          r.seenShots.add(seq);
          if (r.seenShots.size > 64) r.seenShots.delete(r.seenShots.values().next().value);
        }
        r.shots.push({ t: snap.t, s });
      }
    }
  }

  /** our weapon fired: goes out with the next state message */
  queueShot(from, to, kind) {
    const r2 = (v) => Math.round(v * 100) / 100;
    if (this.outShots.length < 12) this.outShots.push({ s: [r2(from.x), r2(from.y), r2(from.z), r2(to.x), r2(to.y), r2(to.z), kind, ++this.shotSeq], sends: 0 });
  }

  /** a player died / came back: collapse the soldier, hide tag + dot, ignore for hits */
  setDead(id, dead) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dead = dead;
    if (dead) r.avatar.die();
    else {
      r.avatar.revive();
      r.buffer.reset(); // the respawn is a teleport: snap to the new spot
      r.has = false;
      r.avatar.root.visible = false;
    }
  }

  /**
   * Nearest other player hit by a ray (what WE see: their delayed, interpolated position).
   * @returns {null | {t:number, id:number, head:boolean, x:number, y:number, z:number, viewTime:number}}
   */
  raycastPlayers(ox, oy, oz, dx, dy, dz, maxT) {
    const targets = [];
    for (const r of this.remotes.values()) {
      if (!r.has || r.dead || !r.avatar.root.visible) continue;
      targets.push({ id: r.id, box: hitboxOf(r.pos.x, r.pos.y, r.pos.z, r.avatar.crouch) });
    }
    const hit = rayPlayers(targets, ox, oy, oz, dx, dy, dz, maxT);
    if (hit) hit.viewTime = this.room.now() - this.remotes.get(hit.id).buffer.delay;
    return hit;
  }

  /**
   * @param {number} dt seconds
   * @param {boolean} playing  our player is in the map (intro over)
   */
  update(dt, playing) {
    const now = this.room.now();

    // ---- send our state
    this.sendT -= dt * 1000;
    if (playing && this.room.synced && this.sendT <= 0) {
      this.sendT = Math.max(0, this.sendT + SEND_INTERVAL);
      const c = this.player.core;
      const sprint = Math.hypot(c.vx, c.vz) > this.cfg.player.walkSpeed + 0.5;
      const flags = (c.crouching ? FLAG.crouch : 0) | (c.grounded ? FLAG.grounded : 0) | (sprint ? FLAG.sprint : 0) | (c.fly ? FLAG.fly : 0);
      const msg = encodeState(this.room.selfId, this.k++, now, c, flags, this.outShots.map((o) => o.s));
      for (const o of this.outShots) o.sends++;
      this.outShots = this.outShots.filter((o) => o.sends < 2);
      if (this.room.isHost) this.room.broadcastFast(msg);
      else this.room.sendFast(msg);
      this.stats.sent++;
    }

    // ---- move the others
    const cam = this.camera.position;
    for (const r of this.remotes.values()) {
      const s = r.buffer.sample(now, r.s);
      if (s.mode === "none") continue;
      const target = this._anchor.set(s.x, s.y, s.z);
      if (!r.has || r.pos.distanceTo(target) > 3) r.pos.copy(target); // first state / teleport: snap
      else r.pos.lerp(target, Math.min(1, dt * 30)); // hides small corrections after extrapolating
      r.has = true;
      if (!r.dead) r.avatar.root.visible = true;
      r.avatar.update(dt, { ...s, x: r.pos.x, y: r.pos.y, z: r.pos.z });

      // their shots, in step with where we draw them (or right away if they're very late)
      const playUntil = now - r.buffer.delay;
      while (r.shots.length && (r.shots[0].t <= playUntil || r.shots[0].t < now - 1000)) {
        const { s: shot } = r.shots.shift();
        r.revealUntil = now + 1500;
        this.onRemoteShot?.(r.id, shot);
      }

      // footsteps
      const grounded = (s.f & FLAG.grounded) !== 0;
      const moved = Math.hypot(r.pos.x - r.prev.x, r.pos.z - r.prev.z);
      r.prev.copy(r.pos);
      if (grounded && moved < 2) {
        r.stepDist += moved;
        const sprint = (s.f & FLAG.sprint) !== 0;
        if (r.stepDist > (sprint ? 2.6 : 2.0)) {
          r.stepDist = 0;
          if (!(s.f & FLAG.crouch)) this.sfx.footstepAt(r.pos, sprint, cam);
        }
      }
    }

    // ---- who can we see? (throttled: a few raycasts per player)
    this.visT -= dt;
    if (this.visT <= 0) {
      this.visT = VIS_INTERVAL;
      this.camera.updateMatrixWorld();
      this._m.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._m);
      for (const r of this.remotes.values()) {
        r.visible = playing && r.has && !r.dead && this.canSee(r);
      }
    }

    // ---- name tags
    for (const r of this.remotes.values()) {
      if (!r.visible) {
        this.tags.place(r.id, null, this.camera);
        continue;
      }
      r.avatar.root.updateMatrixWorld(true);
      const stale = now - r.lastArrival > STALE_MS;
      this.tags.place(r.id, r.avatar.tagAnchor(this._anchor), this.camera, stale ? "connection lost…" : "");
    }
  }

  /** in the view frustum, and head or chest not hidden behind letters */
  canSee(r) {
    r.avatar.root.updateMatrixWorld(true);
    const pts = r.avatar.sightPoints(this._pts);
    const cam = this.camera.position;
    for (const p of pts) {
      if (!this._frustum.containsPoint(p)) continue;
      const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.01) return true;
      const hit = this.collision.raycast(cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d);
      // the floor can't block a point above it; letters can
      if (!hit || !hit.body || hit.t >= d - 0.05) return true;
    }
    return false;
  }

  /**
   * Soft push: slide our own body out of other players (each client moves only itself).
   * Call before the player update.
   */
  pushLocal(dt) {
    const c = this.player.core;
    const r0 = this.cfg.player.radius;
    const minD = r0 * 2;
    for (const r of this.remotes.values()) {
      if (!r.has) continue;
      if (Math.abs(c.y - r.pos.y) > 1.6) continue; // one is standing on a tall letter
      let dx = c.x - r.pos.x, dz = c.z - r.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= minD) continue;
      if (d < 1e-3) {
        // exactly on top of each other (same spawn): split by id
        const a = (this.room.selfId - r.id) * 2.4;
        dx = Math.cos(a);
        dz = Math.sin(a);
        d = 1;
      }
      const push = Math.min(minD - d, (minD - d) * dt * 20 + 0.01);
      const res = this.collision.resolve(c.x + (dx / d) * push, c.z + (dz / d) * push, r0, c.y, this.cfg.player.stepHeight);
      c.x = res.x;
      c.z = res.z;
    }
  }

  /** last position we heard from a player (host: plausibility check for their hits) */
  positionOf(id) {
    const s = this.remotes.get(id)?.buffer.latest;
    return s ? { x: s.x, z: s.z } : null;
  }

  /** visible remote players for the minimap */
  minimapDots() {
    const out = [];
    for (const r of this.remotes.values()) {
      // in sight, or just fired a shot (gunfire gives you away, even through letters)
      if (!r.dead && r.has && (r.visible || r.revealUntil > this.room.now())) out.push({ x: r.pos.x, z: r.pos.z, yaw: r.s.yaw ?? 0, color: r.info.color });
    }
    return out;
  }

  dispose() {
    for (const r of this.remotes.values()) r.avatar.dispose();
    this.remotes.clear();
    this.tags.dispose();
  }
}
