// MP4 glue: wires the combat referee (net/combat.js) into the game: weapon -> player hits,
// deaths / killcam / respawns, damage HUD, kill feed, scoreboard, other players' shots.
import * as THREE from "three";
import { Combat, COMBAT } from "../net/combat.js";
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
        ping: p.host ? "host" : typeof p.ping === "number" ? `${Math.round(p.ping)} ms` : "",
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

    /** the room's player list changed */
    setPlayers(list) {
      combat.syncPlayers(list.map((p) => p.id));
      if (boardOpen) chud.scoreboard(rows(), self());
    },

    /** late join: who's dead, HP, kills / deaths */
    applySnapshot(rows) {
      combat.applySnapshot(rows);
      for (const [id, p] of combat.players) if (!p.alive && id !== self()) sync.setDead(id, true);
    },

    update(dt) {
      if (room.isHost) combat.record(self(), now(), player.core.x, player.core.y, player.core.z, player.core.crouching);
      combat.update();
      const me = combat.get(self());
      if (me) {
        chud.setHp(me.hp);
        chud.protection(me.alive && combat.isProtected(self()));
      }
      if (deadInfo) {
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
    },
  };
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
