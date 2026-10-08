// MP4 glue: wires the combat referee (net/combat.js) into the game: weapon -> player hits,
// deaths / killcam / respawns, damage HUD, kill feed, scoreboard, other players' shots.
// MP5: the match (net/match.js): first to 10, end card + top-down view of the wrecked CV,
// host-started rematch on a fresh CV.
import * as THREE from "three";
import { Combat, COMBAT } from "../net/combat.js";
import { Match } from "../net/match.js";
import { MatchHud } from "../ui/matchHud.js";
import { FLAG } from "../net/snapshots.js";
import { findSpawn } from "../world/layout.js";

/**
 * @param {object} o
 * @param {import("../net/room.js").HostRoom | import("../net/room.js").GuestRoom} o.room
 * @param {import("../net/sync.js").NetSync} o.sync
 * @param {import("../net/letters.js").LetterNet} o.letters
 * @param {import("../player/playerController.js").PlayerController} o.player
 * @param {import("../player/weapon.js").Weapon} o.weapon
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {import("../ui/hud.js").Hud} o.hud
 * @param {import("../ui/combatHud.js").CombatHud} o.chud
 * @param {import("../fx/remoteShots.js").RemoteShots} o.shots
 * @param {import("../audio/sfx.js").Sfx} o.sfx
 * @param {any} o.world
 * @param {typeof import("../config.js").config} o.cfg
 * @param {() => void} o.onStats   kills / deaths changed (refresh player list)
 * @param {() => void} o.resetWorld  rematch: every letter back, clean paper, no debris
 * @param {(on:boolean) => void} o.endView  end of match: camera up to the top view of the page
 * @param {number} [o.target=10] kills to win
 */
export function createPvp(o) {
  const { room, sync, player, weapon, camera, hud, chud, shots, sfx, world, cfg } = o;
  const self = () => room.selfId;
  const now = () => room.now();
  const info = (id) => room.players.find((p) => p.id === id) || { id, name: `Player ${id}`, color: "#ccc" };

  // ---------------------------------------------------------------- respawn spots (host)
  let spots = null;
  const spawnSpots = () => {
    if (spots) return spots;
    const { W, D } = world.size;
    spots = [];
    for (let gz = 0; gz < 6; gz++) {
      for (let gx = 0; gx < 5; gx++) {
        const s = findSpawn(world.entities, W, D, cfg.player.radius, { x: ((gx + 0.5) / 5) * W, z: ((gz + 0.5) / 6) * D });
        if (spots.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 6)) spots.push(s);
      }
    }
    return spots;
  };
  /** the free spot farthest from every living enemy */
  const spawnFor = (id) => {
    const enemies = [];
    if (id !== self() && combat.get(self())?.alive) enemies.push({ x: player.core.x, z: player.core.z });
    for (const r of sync.remotes.values()) if (r.id !== id && r.has && !r.dead) enemies.push({ x: r.pos.x, z: r.pos.z });
    let best = null, bestD = -1;
    for (const s of spawnSpots()) {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(s.x - e.x, s.z - e.z));
      d += Math.random() * 3; // don't always pick the very same corner
      if (d > bestD) { bestD = d; best = s; }
    }
    const { W, D } = world.size;
    return { x: best.x, z: best.z, yaw: Math.atan2(-(W / 2 - best.x), -(D / 2 - best.z)) };
  };

  // ---------------------------------------------------------------- local death state
  let deadInfo = null; // {killer, head, at}
  const camTarget = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  const combat = new Combat({
    isHost: room.isHost,
    selfId: self,
    now,
    round: () => match.round,
    toHost: (m) => room.send(m),
    toAll: (m) => room.broadcast(m),
    spawnFor,
    fx: {
      hurt(v, by, hp, head, from) {
        if (v === self()) {
          const before = chud.hp < 0 ? COMBAT.maxHp : chud.hp;
          let angle = null;
          if (from) {
            // shooter direction relative to where we look (yaw 0 looks along -Z)
            const a = Math.atan2(-(from.x - player.core.x), -(from.z - player.core.z));
            angle = wrap(a - player.core.yaw);
          }
          chud.damage(Math.max(1, before - hp), angle);
          chud.setHp(hp);
          sfx.hurt(before - hp);
          player.addShake(0.05);
        }
      },
      died(v, by, head) {
        chud.killFeed(info(by), info(v), head, self());
        if (room.isHost) match.check(scoreRows);
        if (by === self() && v !== self()) hud.hitMarker("kill");
        if (v === self()) {
          deadInfo = { killer: by, head, at: now() };
          player.dead = true;
          weapon.blocked = true;
          weapon.mouseTrigger = weapon.keyTrigger = false;
          chud.setHp(0);
          camPos.copy(camera.position);
          document.getElementById("crosshair").style.visibility = "hidden";
        } else sync.setDead(v, true);
        o.onStats();
      },
      respawned(id, s, until) {
        if (id === self()) {
          deadInfo = null;
          player.spawn(s.x, s.z, s.yaw);
          player.dead = false;
          weapon.blocked = false;
          weapon.ammo = weapon.w.magazine;
          weapon.reloading = 0;
          weapon.onAmmo?.(weapon);
          chud.killcam(null);
          chud.setHp(COMBAT.maxHp);
          document.getElementById("crosshair").style.visibility = "";
        } else sync.setDead(id, false);
      },
      stats: () => o.onStats(),
    },
  });

  // ---------------------------------------------------------------- the match (MP5)
  const mhud = new MatchHud();
  const scoreRows = () =>
    [...combat.players].map(([id, p]) => ({ id, kills: p.kills, deaths: p.deaths, letters: o.letters?.kills.get(id) ?? 0, heads: p.heads, best: p.best }));
  const match = new Match({
    isHost: room.isHost,
    target: o.target ?? 10,
    toAll: (m) => room.broadcast(m),
    fx: {
      ended(m) {
        combat.enabled = false;
        deadInfo = null;
        chud.killcam(null);
        player.dead = true; // the camera belongs to the end view now
        weapon.blocked = true;
        weapon.mouseTrigger = weapon.keyTrigger = false;
        document.getElementById("crosshair").style.visibility = "hidden";
        document.exitPointerLock?.();
        const rows = m.scores.map(([id, kills, deaths, letters]) => ({ ...info(id), id, kills, deaths, letters }));
        mhud.showEnd({
          winner: { ...info(m.winner), id: m.winner },
          rows,
          awards: m.awards,
          info,
          round: m.round,
          target: m.target,
          isHost: room.isHost,
          hostName: room.players.find((p) => p.host)?.name || "the host",
          selfId: self(),
        });
        o.endView(true);
        o.onStats();
      },
      started(m) {
        o.resetWorld();
        o.letters?.reset();
        combat.resetRound(m.protUntil);
        for (const [id, x, z, yaw] of m.spawns) {
          if (id === self()) player.spawn(x, z, yaw);
          else sync.setDead(id, false); // snaps their soldier to wherever they appear next
        }
        for (const r of sync.remotes.values()) r.avatar.revive();
        deadInfo = null;
        player.dead = false;
        weapon.blocked = false;
        weapon.ammo = weapon.w.magazine;
        weapon.reloading = 0;
        weapon.onAmmo?.(weapon);
        chud.killcam(null);
        chud.setHp(COMBAT.maxHp);
        document.getElementById("crosshair").style.visibility = "";
        mhud.hideEnd();
        o.endView(false);
        o.onStats();
      },
    },
  });
  o.letters.round = () => match.round;

  /** spread everyone over the page: each next spot as far as possible from the ones taken */
  const rematchSpawns = () => {
    const taken = [];
    const out = [];
    const { W, D } = world.size;
    for (const p of room.players) {
      let best = null, bestD = -1;
      for (const s of spawnSpots()) {
        let d = taken.length ? Infinity : Math.random() * 100;
        for (const t of taken) d = Math.min(d, Math.hypot(s.x - t.x, s.z - t.z));
        if (d > bestD) { bestD = d; best = s; }
      }
      taken.push(best);
      out.push([p.id, best.x, best.z, Math.atan2(-(W / 2 - best.x), -(D / 2 - best.z))]);
    }
    return out;
  };
  mhud.onRematch = () => {
    if (!room.isHost || match.playing) return;
    match.rematch(rematchSpawns(), now() + COMBAT.protection * 1000);
  };

  // ---------------------------------------------------------------- weapon <-> network
  weapon.playerRay = (ox, oy, oz, dx, dy, dz, maxT) => sync.raycastPlayers(ox, oy, oz, dx, dy, dz, maxT);
  weapon.onPlayerHit = (ph) => {
    if (combat.isProtected(ph.id)) return; // spawn protection: the bullet does nothing
    combat.localHit({ victim: ph.id, head: ph.head, dist: ph.t, point: ph, viewTime: ph.viewTime });
  };
  weapon.onFired = (from, to, kind) => {
    sync.queueShot(from, to, kind);
    combat.firedBy(self()); // shooting ends our own spawn protection
  };
  sync.onRemoteShot = (id, shot) => shots.play(shot, camera.position);
  if (room.isHost) {
    sync.onState = (id, s) => combat.record(id, s.t, s.x, s.y, s.z, (s.f & FLAG.crouch) !== 0);
    sync.onFired = (id) => combat.firedBy(id);
  }

  // ---------------------------------------------------------------- scoreboard (hold Tab)
  let boardOpen = false;
  const rows = () =>
    room.players.map((p) => {
      const c = combat.get(p.id);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        kills: c?.kills ?? 0,
        deaths: c?.deaths ?? 0,
        letters: o.letters?.kills.get(p.id) ?? 0,
        ping: p.host ? "host" : p.state === "away" ? "away" : typeof p.ping === "number" ? `${Math.round(p.ping)} ms` : "",
        alive: c?.alive ?? true,
      };
    }).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const onKey = (e) => {
    if (e.code !== "Tab") return;
    e.preventDefault();
    boardOpen = e.type === "keydown";
    chud.scoreboard(boardOpen ? rows() : null, self());
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKey);

  chud.show(true);
  chud.setHp(COMBAT.maxHp);

  return {
    combat,
    match,

    /** a reliable game message (combat or match) */
    onMessage(msg, from) {
      return combat.onMessage(msg, from) || match.onMessage(msg);
    },

    /** what a joining guest needs (host) */
    snapshot() {
      return { combat: combat.snapshot(), match: match.snapshot() };
    },

    /** the room's player list changed */
    setPlayers(list) {
      combat.syncPlayers(list.map((p) => p.id));
      if (boardOpen) chud.scoreboard(rows(), self());
    },

    /** late join: who's dead, HP, kills / deaths, and the match (maybe its end screen) */
    applySnapshot(w) {
      combat.applySnapshot(w?.combat);
      for (const [id, p] of combat.players) if (!p.alive && id !== self()) sync.setDead(id, true);
      match.applySnapshot(w?.match);
    },

    update(dt) {
      if (room.isHost) combat.record(self(), now(), player.core.x, player.core.y, player.core.z, player.core.crouching);
      combat.update();
      const me = combat.get(self());
      if (me) {
        chud.setHp(me.hp);
        chud.protection(me.alive && combat.isProtected(self()));
      }
      // match bar: target, leader, our kills
      let leader = null;
      for (const [id, p] of combat.players) if (p.kills > 0 && (!leader || p.kills > leader.kills)) leader = { ...info(id), kills: p.kills };
      mhud.bar({ target: match.target, leader: leader && { name: leader.name, color: leader.color, kills: leader.kills }, you: me?.kills ?? 0, round: match.round });
      if (deadInfo && match.playing) {
        // killcam: rise a little behind our body and watch the killer
        const left = COMBAT.respawnDelay - (now() - deadInfo.at) / 1000;
        const k = info(deadInfo.killer);
        chud.killcam({ name: k.name, color: k.color, head: deadInfo.head, left });
        const r = sync.remotes.get(deadInfo.killer);
        if (r?.has) camTarget.set(r.pos.x, r.pos.y + 1.4, r.pos.z);
        else camTarget.set(player.core.x, 0, player.core.z - 0.01);
        camPos.y += (player.core.y + 3.2 - camPos.y) * Math.min(1, dt * 2);
        camera.position.copy(camPos);
        camera.lookAt(camTarget);
      }
      if (boardOpen) chud.scoreboard(rows(), self());
    },

    dispose() {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
      weapon.playerRay = weapon.onPlayerHit = weapon.onFired = null;
      weapon.blocked = false;
      player.dead = false;
      document.getElementById("crosshair").style.visibility = "";
      chud.reset();
      mhud.dispose();
      o.endView(false);
    },
  };
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
