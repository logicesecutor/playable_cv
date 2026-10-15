// S7: death by shredder. When the cut catches a player (net/combat.js "caught"), for
// CATCH_SECONDS everyone sees the same thing before the host kills them:
//   - the victim's own screen: no more control, the camera turns to the slot, slides along the
//     paper to it and goes down through the slot into the spinning cutters (world/office.js
//     buildCutters), shaking harder and harder; then the view tears into paper strips (#shred-tear)
//     and stays in the cutters for the respawn countdown;
//   - everyone else: the soldier is pulled along the page into the slot, clipped by the slot's
//     plane as it goes in, while paper strips in the victim's colour spray out of the slot;
//   - a scream (sfx.scream) and paper crunching when the body reaches the cutters.
// The path: along the page to the slot line (the plane's closest point), then down the slot
// (-normal) to below the cutters. Without the animated office the plane is the vertical cut
// plane across the page (main.js) and there are no cutters: the body just goes through the cut.
import * as THREE from "three";
import { ParticleSystem } from "./particles.js";

const smooth = (k) => k * k * (3 - 2 * k);
const PAPER = new THREE.Color(0.95, 0.94, 0.9);

export class ShredDeath {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {{core:{x:number,z:number}}} o.player
   * @param {() => any} o.sync         NetSync (remote avatars), or null
   * @param {() => THREE.Plane} o.plane the slot: normal out of the shredder, inside = negative side
   * @param {() => number} o.depth     game metres from the slot down to below the cutters
   * @param {any} o.sfx
   * @param {number} [o.particles=1]   graphics preset's particle multiplier
   */
  constructor(o) {
    this.o = o;
    /** @type {Map<number, any>} id -> sequence */
    this.active = new Map();
    this.confetti = new ParticleSystem(Math.round(900 * (o.particles ?? 1)) || 300, { gravity: 2.5, drag: 1.3 });
    o.scene.add(this.confetti.points);
    this.tear = document.getElementById("shred-tear");
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._e = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._side = new THREE.Vector3();
  }

  /** the particles need the viewport like the others (main.js resize) */
  setViewport(px, fov) {
    this.confetti.setViewport(px, fov);
  }

  /**
   * The shredder caught player `id`.
   * @param {{self:boolean, color:string, at:{x:number,z:number}, until:number, now:number}} c
   */
  caught(id, c) {
    if (this.active.has(id)) return;
    const pos = c.self ? this.o.player.core : this.o.sync()?.remotes.get(id)?.pos;
    const a = {
      id,
      self: c.self,
      t: 0,
      t0: performance.now(), // the sequence runs on the wall clock (a slow frame rate can't stretch it)
      dur: Math.max(0.4, (c.until - c.now) / 1000),
      start: new THREE.Vector3(pos?.x ?? c.at.x, 0, pos?.z ?? c.at.z),
      color: new THREE.Color(c.color),
      dead: false,
      deadT: 0,
      crunched: false,
      mats: null,
    };
    if (c.self) {
      a.eye = this.o.camera.position.clone();
      a.look = new THREE.Vector3();
      this.o.camera.getWorldDirection(a.look);
    } else this.clipAvatar(a, true);
    this.o.sfx.scream?.(c.self ? null : a.start.clone().setY(1.5), id);
    this.active.set(id, a);
  }

  /** the host's death came in: the remote body is gone into the shredder */
  died(id) {
    const a = this.active.get(id);
    if (!a) return;
    a.dead = true;
    a.deadAt = performance.now();
    a.t0 = Math.min(a.t0, a.deadAt - a.dur * 1000); // (a late death message: finish the path)
  }

  /** respawned (or a new match): back to normal */
  clear(id) {
    const a = this.active.get(id);
    if (!a) return;
    if (!a.self) this.clipAvatar(a, false);
    if (a.self && this.tear) this.tear.classList.remove("on");
    this.active.delete(id);
  }

  clearAll() {
    for (const id of [...this.active.keys()]) this.clear(id);
  }

  /** is our own camera in the shredder's hands? */
  get ownActive() {
    for (const a of this.active.values()) if (a.self) return true;
    return false;
  }

  /** the victim's soldier: its own copies of the materials, clipped by the slot's plane */
  clipAvatar(a, on) {
    const r = this.o.sync()?.remotes.get(a.id);
    if (!r) return;
    if (on) {
      a.mats = [];
      const planes = [this.o.plane()];
      r.avatar.root.traverse((m) => {
        if (!m.isMesh) return;
        const orig = m.material;
        m.material = Array.isArray(orig)
          ? orig.map((x) => Object.assign(x.clone(), { clippingPlanes: planes }))
          : Object.assign(orig.clone(), { clippingPlanes: planes });
        a.mats.push([m, orig]);
      });
    } else if (a.mats) {
      for (const [m, orig] of a.mats) {
        for (const x of [m.material].flat()) x.dispose();
        m.material = orig;
      }
      a.mats = null;
      r.avatar.root.rotation.x = 0;
    }
  }

  /**
   * Where the body is, k (0..1) along the way: the slot entry first (closest point of the plane),
   * then down through the slot. Also returns the entry point in `entry`.
   */
  pathAt(a, k, out, entry = this._e) {
    const plane = this.o.plane();
    const n = plane.normal;
    entry.copy(a.start).addScaledVector(n, -plane.distanceToPoint(a.start));
    if (k < 0.3) return out.lerpVectors(a.start, entry, smooth(k / 0.3));
    return out.copy(entry).addScaledVector(n, -this.o.depth() * smooth((k - 0.3) / 0.7));
  }

  update(dt) {
    this.confetti.update(dt);
    if (!this.active.size) return;
    const n = this.o.plane().normal;
    const ms = performance.now();
    for (const a of this.active.values()) {
      a.t = (ms - a.t0) / 1000;
      if (a.dead) a.deadT = (ms - a.deadAt) / 1000;
      const k = Math.min(1, a.t / a.dur);
      const p = this.pathAt(a, k, this._v);
      const entry = this._e;

      // paper strips in their colour out of the slot (from when the body reaches it)
      if (k > 0.25 && a.deadT < 0.7) {
        this._side.set(0, 1, 0).cross(n);
        if (this._side.lengthSq() < 1e-6) this._side.set(1, 0, 0);
        this._side.normalize();
        const count = Math.random() < dt * 140 ? 1 + ((Math.random() * dt * 140) | 0) : 0;
        for (let i = 0; i < count; i++) {
          const c = Math.random() < 0.6 ? a.color : PAPER;
          const sp = 3 + Math.random() * 7, lat = (Math.random() - 0.5) * 8;
          const o = this._t.copy(entry).addScaledVector(n, 0.8).addScaledVector(this._side, (Math.random() - 0.5) * 2);
          this.confetti.emit(o.x, o.y + 0.3, o.z,
            n.x * sp + this._side.x * lat, n.y * sp + 3 + Math.random() * 3, n.z * sp + this._side.z * lat,
            1.8 + Math.random(), 0.28, 0.2, c.r, c.g, c.b, 1);
        }
      }
      // crunch when the body reaches the cutters
      if (!a.crunched && k > 0.55) {
        a.crunched = true;
        this.o.sfx.shredCrunch?.(a.self ? null : entry.clone());
      }

      if (a.self) this.drive(a, k, p, n, entry);
      else {
        const r = this.o.sync()?.remotes.get(a.id);
        if (!r) continue;
        if (a.dead) r.avatar.root.visible = false;
        else {
          r.avatar.root.position.copy(p);
          r.avatar.root.rotation.x = -1.1 * smooth(k); // falls back into the slot
        }
      }
    }
  }

  /** our own view: to the slot, into it, through the cutters; then torn up */
  drive(a, k, p, n, entry) {
    const cam = this.o.camera;
    const e = smooth(k);
    // eye: standing height above the page at first, then just behind the body going down the slot
    const eye = this._w.set(0, 1.6 * (1 - e), 0).addScaledVector(n, 0.4 * e).add(p);
    if (a.t < 0.15) eye.lerpVectors(a.eye, eye, a.t / 0.15); // no jump from the last view
    // look: from where we looked, to the slot, then down into it
    const target = this._t;
    if (k < 0.3) target.copy(a.eye).addScaledVector(a.look, 10).lerp(entry, smooth(k / 0.3));
    else target.copy(entry).addScaledVector(n, -this.o.depth() * 2);
    const shake = 0.04 + 0.35 * e + (a.dead ? 0.15 : 0);
    eye.x += (Math.random() - 0.5) * shake;
    eye.y += (Math.random() - 0.5) * shake;
    eye.z += (Math.random() - 0.5) * shake;
    cam.position.copy(eye);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.rotateZ(Math.sin(a.t * 37) * 0.06 * e);
    if (this.tear && k > 0.72) this.tear.classList.add("on");
  }

  dispose() {
    this.clearAll();
    this.confetti.points.removeFromParent();
    this.confetti.points.geometry.dispose();
    this.confetti.material.dispose();
  }
}
