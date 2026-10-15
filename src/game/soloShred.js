// S8: the shredder when you play alone, with the same rules as a match (game/pvp.js) but on this
// screen's own clock: 1:30 after the intro she reaches for the CV (countdown, notices), the
// shredder eats the page from the top (main.js applyCut: letters, floor, minimap, office), and if
// the cut reaches you you're caught, pulled into the slot (fx/shredDeath.js: scream, cutters),
// dead CATCH seconds later and back 3 s after that, well below the cut. When the page is used up:
// the top view and an end card ("Play again": a whole page and a fresh clock).
// Opening an invite (main.js wireRoom) replaces this with a real match.
import { shredState, gameMetres, spawnClear, SPAWN_LEAD, CATCH_REACH, CATCH_SECONDS } from "./shredder.js";
import { ShredAnnouncer } from "./shredAnnouncer.js";
import { MatchHud } from "../ui/matchHud.js";
import { findSpawn } from "../world/layout.js";

const RESPAWN_S = 3; // like a match (net/combat.js COMBAT.respawnDelay)

export class SoloShred {
  /**
   * @param {object} o
   * @param {any} o.world
   * @param {typeof import("../config.js").config} o.cfg
   * @param {any} o.player
   * @param {any} o.weapon
   * @param {import("../ui/combatHud.js").CombatHud} o.chud
   * @param {any} o.sfx
   * @param {import("../fx/shredDeath.js").ShredDeath} o.shredDeath
   * @param {() => void} o.resetWorld   every letter back, clean paper
   * @param {(on:boolean) => void} o.endView  the top view of the page (or back)
   * @param {() => number} o.lettersShot  letters the player destroyed (for the end card)
   * @param {number} [o.after]  seconds before she reaches (dev: ?shred=N); default config.shredder.after
   */
  constructor(o) {
    this.o = o;
    const c = o.cfg.shredder;
    this.timings = { ...c, after: Number.isFinite(o.after) ? o.after : c.after };
    this.bite = c.bite * gameMetres(o.cfg);
    this.D = o.world.size.D;
    this.mhud = new MatchHud();
    this.mhud.onRematch = () => this.restart();
    this.announcer = new ShredAnnouncer({ mhud: this.mhud, sfx: o.sfx, grab: c.grab });
    this.startAt = null; // performance.now() when the clock started (the intro ended)
    this.state = shredState(null, this.timings, this.D, this.bite);
    this.deaths = 0;
    this.caughtUntil = 0; // being pulled in until then (ms)
    this.respawnAt = 0; // dead until then (ms)
    this.ended = false;
  }

  /** {phase, t, progress, cutZ, countdown} like pvp.shred */
  get shred() {
    return this.state;
  }

  /** has the shredder started on the page (her grab or later)? */
  get started() {
    return this.state.phase !== "waiting";
  }

  /** dev (O key): she reaches for the CV right now */
  skip() {
    if (this.ended || this.started) return false;
    this.startAt = performance.now() - this.timings.after * 1000;
    return true;
  }

  update(dt, playing) {
    if (!playing) return;
    const ms = performance.now();
    if (this.startAt == null) this.startAt = ms;
    if (!this.ended) this.state = shredState((ms - this.startAt) / 1000, this.timings, this.D, this.bite);
    this.announcer.update(this.state, !this.ended);
    if (this.ended) return;
    const s = this.state;
    this.mhud.shredBar(s.phase === "feeding" ? s.progress : null);
    if (s.phase === "done") return this.end();

    const { player, chud } = this.o;
    if (this.caughtUntil) {
      if (ms >= this.caughtUntil) {
        // through the cutters
        this.caughtUntil = 0;
        this.deaths++;
        this.respawnAt = ms + RESPAWN_S * 1000;
        this.o.shredDeath.died(0);
      }
    } else if (this.respawnAt) {
      chud.killcam({ name: "the shredder", color: "#ff5a36", head: false, left: (this.respawnAt - ms) / 1000, shredded: true });
      if (ms >= this.respawnAt) this.respawn();
    } else if (s.cutZ > 0 && !player.dead && player.core.z < s.cutZ + CATCH_REACH) {
      // caught: no more control, pulled into the slot (fx/shredDeath.js)
      this.lock(true);
      const until = ms + (this.timings.catch ?? CATCH_SECONDS) * 1000;
      this.caughtUntil = until;
      this.o.shredDeath.caught(0, { self: true, color: "#ff5a36", at: { x: player.core.x, z: player.core.z }, until, now: ms });
    }
  }

  /** no control (caught, dead, end card), or back */
  lock(on) {
    const { player, weapon } = this.o;
    player.dead = on;
    weapon.blocked = on;
    if (on) weapon.releaseTriggers();
    document.getElementById("crosshair").style.visibility = on ? "hidden" : "";
  }

  /** back on the page, well below the cut, facing away from the shredder */
  respawn() {
    const { player, world, cfg, chud } = this.o;
    this.respawnAt = 0;
    chud.killcam(null);
    this.o.shredDeath.clear(0);
    const { W, D } = world.size;
    const cut = this.state.cutZ;
    let x = player.core.x, z = player.core.z, yaw = player.core.yaw;
    if (!spawnClear(z, cut)) {
      const s = findSpawn(world.entities.filter((e) => e.alive), W, D, cfg.player.radius, { x, z: Math.min(D - 3, cut + SPAWN_LEAD + 10) });
      x = s.x;
      z = s.z;
      yaw = Math.PI;
    }
    player.spawn(x, z, yaw);
    this.lock(false);
  }

  /** the page is used up: the top view and the end card */
  end() {
    this.ended = true;
    this.caughtUntil = this.respawnAt = 0;
    this.o.shredDeath.clearAll();
    this.o.chud.killcam(null);
    this.mhud.shredBar(null);
    this.lock(true);
    this.o.player.unlock();
    this.mhud.showSolo({ deaths: this.deaths, letters: this.o.lettersShot() });
    this.o.endView(true);
  }

  /** "Play again": a whole page, the CV back in the tray, a fresh clock */
  restart() {
    if (!this.ended) return;
    this.ended = false;
    this.deaths = 0;
    this.startAt = performance.now();
    this.state = shredState(0, this.timings, this.D, this.bite);
    this.announcer.reset();
    this.o.resetWorld();
    this.mhud.hideEnd();
    this.o.endView(false);
    const { player, world } = this.o;
    player.spawn(world.spawn.x, world.spawn.z, 0);
    this.lock(false);
  }

  /** an invite was opened: a real match takes over (main.js) */
  dispose() {
    if (this.caughtUntil || this.respawnAt || this.ended) {
      this.o.shredDeath.clearAll();
      this.o.chud.killcam(null);
      if (this.ended) this.o.endView(false);
      const { player } = this.o;
      if (this.caughtUntil || this.respawnAt) this.respawn();
      else this.lock(false);
    }
    this.mhud.dispose();
  }
}
