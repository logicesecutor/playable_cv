// Other players' shots: tracer, muzzle flash, positional gunshot, and what the bullet did at the
// far end (floor scorch, a puff on a player). Letter hits are not drawn here: they arrive from
// the host as shared destruction (MP3).
import * as THREE from "three";
import { pickWord } from "./wordShots.js";

export class RemoteShots {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../audio/sfx.js").Sfx} sfx
   * @param {import("../world/destruction.js").Destruction} destruction
   */
  constructor(scene, sfx, destruction) {
    this.sfx = sfx;
    this.destruction = destruction;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.userData.t = 0;
      scene.add(m);
      this.tracers.push(m);
    }
    this.next = 0;
    this.flashes = [];
    const tex = flashTexture();
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffc070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.visible = false;
      s.userData.t = 0;
      scene.add(s);
      this.flashes.push(s);
    }
    this.nextFlash = 0;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this.played = 0;
    /** @type {import("./wordShots.js").WordShots|null} their shots print words too (main.js) */
    this.words = null;
  }

  /**
   * @param {number[]} s [ox,oy,oz, ex,ey,ez, kind, seq]  kind 0 miss, 1 floor, 2 letter, 3 player
   * @param {THREE.Vector3} listener our camera position
   * @param {number} [shooter] their player id (picks the same word they saw)
   */
  play(s, listener, shooter = 0) {
    const [ox, oy, oz, ex, ey, ez, kind, seq = 0] = s;
    this.played++;
    const from = this._a.set(ox, oy, oz), to = this._b.set(ex, ey, ez);
    this.words?.shot(from, to, kind, pickWord(shooter, seq));
    // tracer
    const t = this.tracers[this.next];
    this.next = (this.next + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len > 1) {
      t.position.copy(from).lerp(to, 0.4 / len);
      t.lookAt(to);
      t.scale.set(0.03, 0.03, Math.max(0.01, len - 0.4));
      t.userData.t = 0;
      t.material.opacity = 0.8;
      t.visible = true;
    }
    // muzzle flash
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    f.position.copy(from);
    const sc = 0.5 + Math.random() * 0.3;
    f.scale.set(sc, sc, sc);
    f.material.rotation = Math.random() * Math.PI * 2;
    f.userData.t = 0;
    f.visible = true;
    // sound
    this.sfx.gunshot({ x: ox, y: oy, z: oz }, listener);
    // impact
    if (kind === 1) this.destruction.floorHit({ x: ex, y: 0, z: ez });
    else if (kind === 3) {
      const d = to.clone().sub(from).normalize();
      for (let i = 0; i < 6; i++) {
        const sp = 2 + Math.random() * 3;
        this.destruction.sparks.emit(ex, ey, ez, -d.x * sp + (Math.random() - 0.5) * 2, Math.random() * sp, -d.z * sp + (Math.random() - 0.5) * 2, 0.15, 0.06, 0.02, 3.0, 0.6, 0.4);
      }
      this.sfx.bodyHit({ x: ex, y: ey, z: ez }, false);
    }
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.t += dt;
      const k = 1 - t.userData.t / 0.08;
      if (k <= 0) t.visible = false;
      else t.material.opacity = 0.8 * k;
    }
    for (const f of this.flashes) {
      if (!f.visible) continue;
      f.userData.t += dt;
      if (f.userData.t > 0.05) f.visible = false;
    }
  }
}

function flashTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,230,1)");
  g.addColorStop(0.3, "rgba(255,200,110,0.8)");
  g.addColorStop(1, "rgba(255,90,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
