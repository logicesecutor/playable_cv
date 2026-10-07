// The gun: low-poly view-model drawn in its own pass (so it never clips into letters), automatic
// hitscan fire with spread, magazine + reload, recoil, sway, bob, muzzle flash, light and tracers.
import * as THREE from "three";

export class Weapon {
  /**
   * @param {object} o
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {THREE.Scene} o.scene main scene (tracers + muzzle light live there)
   * @param {import("./playerController.js").PlayerController} o.player
   * @param {import("../world/collision.js").CollisionWorld} o.collision
   * @param {import("../world/destruction.js").Destruction} o.destruction
   * @param {import("../audio/sfx.js").Sfx} o.sfx
   * @param {typeof import("../config.js").config} o.cfg
   */
  constructor(o) {
    Object.assign(this, o);
    const w = (this.w = o.cfg.weapon);
    this.ammo = w.magazine;
    this.cooldown = 0;
    this.reloading = 0; // seconds left
    this.mouseTrigger = false; // left mouse button / touchpad click
    this.keyTrigger = false; // F key
    this.recoil = 0; // view-model kick, decays
    this.flashT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.shots = 0;
    this.hits = 0;
    /** (result: "hit" | "kill" | "floor" | "miss") => void */
    this.onShot = null;
    this.onAmmo = null;

    // ---- view-model scene
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(o.camera.fov, o.camera.aspect, 0.01, 10);
    this.viewScene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2622, 1.4));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.2);
    key.position.set(-1, 2, 1);
    this.viewScene.add(key);

    this.gun = buildGun();
    this.viewScene.add(this.gun.root);
    this.restPos = new THREE.Vector3(0.24, -0.24, -0.5);

    // muzzle flash sprite (child of the gun, so it moves with recoil)
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthTest: false, transparent: true }),
    );
    this.flash.position.copy(this.gun.muzzle);
    this.flash.visible = false;
    this.gun.root.add(this.flash);

    // muzzle light in the world (always present, so toggling it doesn't recompile shaders)
    this.light = new THREE.PointLight(0xffa850, 0, 16, 2);
    o.scene.add(this.light);

    // tracers
    this.tracers = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, 0.5); // extends along +Z so lookAt() aims it
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(
        tg,
        new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.visible = false;
      m.userData.t = 0;
      o.scene.add(m);
      this.tracers.push(m);
    }
    this.nextTracer = 0;

    // ---- input
    this._v = new THREE.Vector3();
    this._listeners = [
      [document, "mousedown", (e) => { if (e.button === 0 && this.canShoot()) { this.mouseTrigger = true; this.dryFireCheck(); } }],
      [document, "mouseup", (e) => { if (e.button === 0) this.mouseTrigger = false; }],
      [document, "keydown", (e) => {
        if (e.code === "KeyR" && this.player.enabled) this.reload();
        if (e.code === "KeyF" && !e.repeat && this.canShoot()) { this.keyTrigger = true; this.dryFireCheck(); }
      }],
      [document, "keyup", (e) => { if (e.code === "KeyF") this.keyTrigger = false; }],
      [window, "blur", () => { this.mouseTrigger = this.keyTrigger = false; }],
      [document, "pointerlockchange", () => { if (!document.pointerLockElement) this.mouseTrigger = this.keyTrigger = false; }],
    ];
    for (const [t, ev, fn] of this._listeners) t.addEventListener(ev, fn);
  }

  get trigger() {
    return this.mouseTrigger || this.keyTrigger;
  }

  canShoot() {
    return this.player.locked && this.player.enabled;
  }

  dryFireCheck() {
    if (this.ammo === 0 && !this.reloading) this.sfx.dryFire();
  }

  reload() {
    if (this.reloading > 0 || this.ammo === this.w.magazine) return;
    this.reloading = this.w.reloadTime;
    this.sfx.reload(this.w.reloadTime);
    this.onAmmo?.(this);
  }

  update(dt) {
    const w = this.w;
    this.cooldown -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = w.magazine;
        this.onAmmo?.(this);
      }
    }
    if (this.trigger && this.player.enabled && this.player.locked && this.reloading === 0) {
      if (this.ammo > 0) {
        while (this.cooldown <= 0 && this.ammo > 0) {
          this.fire();
          this.cooldown += w.fireInterval;
        }
      } else if (w.autoReload) {
        this.reload();
      }
    }
    if (this.cooldown < 0) this.cooldown = 0;

    this.animate(dt);

    // tracers & flash fade
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.t += dt;
      const k = 1 - t.userData.t / 0.07;
      if (k <= 0) t.visible = false;
      else t.material.opacity = 0.85 * k;
    }
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.light.intensity = this.flashT > 0 ? 40 : 0;
  }

  fire() {
    const w = this.w, cam = this.camera, core = this.player.core;
    this.ammo--;
    this.shots++;
    this.onAmmo?.(this);

    // spread grows when moving / airborne, shrinks when crouched
    const speed = Math.hypot(core.vx, core.vz);
    let spread = w.spread + w.moveSpread * Math.min(1, speed / this.cfg.player.sprintSpeed);
    if (!core.grounded) spread += w.airSpread;
    if (core.crouching) spread *= 0.6;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const r = Math.sqrt(Math.random()) * spread, a = Math.random() * Math.PI * 2;
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    let dx = -e[8] + e[0] * ox + e[4] * oy;
    let dy = -e[9] + e[1] * ox + e[5] * oy;
    let dz = -e[10] + e[2] * ox + e[6] * oy;
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    const p = cam.position;
    const hit = this.collision.raycast(p.x, p.y, p.z, dx, dy, dz, w.range);

    let result = "miss";
    if (hit) {
      result = this.destruction.bullet(hit, { x: dx, y: dy, z: dz });
      if (result !== "floor") this.hits++;
    }

    // muzzle in world space: view-model space == camera space
    this.gun.root.updateMatrixWorld();
    const muzzle = this.gun.root.localToWorld(this._v.copy(this.gun.muzzle));
    cam.localToWorld(muzzle);
    const end = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : new THREE.Vector3(p.x + dx * w.range, p.y + dy * w.range, p.z + dz * w.range);
    this.tracer(muzzle, end);
    this.light.position.copy(muzzle);

    // feedback
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const fs = 0.16 + Math.random() * 0.1;
    this.flash.scale.set(fs, fs, fs);
    this.recoil = Math.min(1.6, this.recoil + 1);
    core.pitch = Math.min(1.55, core.pitch + w.kickPitch * (0.7 + Math.random() * 0.6));
    core.yaw += (Math.random() - 0.5) * w.kickYaw;
    this.player.punch += w.punch;
    this.sfx.gunshot();
    this.onShot?.(result, hit);
  }

  tracer(from, to) {
    const t = this.tracers[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % this.tracers.length;
    // start a bit in front of the muzzle so it doesn't cover the gun
    const dir = this._v.copy(to).sub(from);
    const len = dir.length();
    if (len < 1) return;
    dir.divideScalar(len);
    const start = from.clone().addScaledVector(dir, 0.6);
    t.position.copy(start);
    t.lookAt(to);
    t.scale.set(0.02, 0.02, Math.max(0.01, len - 0.6));
    t.userData.t = 0;
    t.material.opacity = 0.85;
    t.visible = true;
  }

  animate(dt) {
    const g = this.gun.root, pl = this.player, core = pl.core;
    // recoil spring
    this.recoil *= Math.exp(-dt * 14);
    // sway follows mouse movement, then settles
    const look = pl.consumeLook();
    this.swayX += (-look.dx * 0.0012 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (look.dy * 0.0012 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.08, Math.min(0.08, this.swayX));
    this.swayY = Math.max(-0.08, Math.min(0.08, this.swayY));

    const speed = Math.hypot(core.vx, core.vz);
    const bobAmt = core.grounded ? Math.min(1, speed / this.cfg.player.sprintSpeed) : 0;
    const ph = pl.bobPhase;
    const sprinting = speed > this.cfg.player.walkSpeed + 0.5 && !this.trigger;
    // reload: dip and tilt the gun
    const rl = this.reloading > 0 ? Math.sin(Math.PI * (1 - this.reloading / this.w.reloadTime)) : 0;

    g.position.set(
      this.restPos.x + Math.cos(ph * 0.5) * 0.014 * bobAmt + this.swayX * 0.4,
      this.restPos.y - Math.abs(Math.sin(ph)) * 0.014 * bobAmt + this.swayY * 0.4 - rl * 0.16 - (sprinting ? 0.04 : 0) + (pl.landDip || 0) * 0.3,
      this.restPos.z + this.recoil * 0.055,
    );
    g.rotation.set(
      this.recoil * 0.09 - rl * 0.7 + this.swayY - (sprinting ? 0.15 : 0),
      this.swayX + (sprinting ? 0.35 : 0),
      -rl * 0.35 + this.swayX * 0.6,
    );
  }

  /** draw the gun on top of the already-rendered frame */
  render(renderer) {
    const c = this.camera, v = this.viewCamera;
    if (v.fov !== c.fov || v.aspect !== c.aspect) {
      v.fov = c.fov;
      v.aspect = c.aspect;
      v.updateProjectionMatrix();
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.viewScene, v);
    renderer.autoClear = auto;
  }

  dispose() {
    for (const [t, ev, fn] of this._listeners) t.removeEventListener(ev, fn);
  }
}

// ------------------------------------------------------------------------------------------------

function buildGun() {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.6, metalness: 0.4 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.85, metalness: 0.0 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff5a36, emissive: 0xff5a36, emissiveIntensity: 0.6, roughness: 0.4 });

  const box = (w, h, d, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    root.add(m);
    return m;
  };
  box(0.07, 0.085, 0.34, metal, 0, 0, 0); // receiver
  box(0.062, 0.06, 0.2, polymer, 0, -0.005, -0.25); // handguard
  box(0.072, 0.012, 0.22, accent, 0, 0.044, -0.03); // accent stripe on top
  box(0.022, 0.035, 0.05, dark, 0, 0.06, 0.08); // rear sight
  box(0.016, 0.03, 0.02, dark, 0, 0.055, -0.3); // front sight
  box(0.042, 0.15, 0.07, dark, 0, -0.11, -0.03, 0.18); // magazine
  box(0.04, 0.11, 0.05, polymer, 0, -0.09, 0.11, -0.35); // grip
  box(0.05, 0.075, 0.2, polymer, 0, -0.01, 0.26); // stock
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.2, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.44);
  root.add(barrel);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.05, 8), metal);
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.012, -0.55);
  root.add(brake);

  return { root, muzzle: new THREE.Vector3(0, 0.012, -0.6) };
}

function flashTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,240,1)");
  g.addColorStop(0.2, "rgba(255,210,120,0.9)");
  g.addColorStop(0.5, "rgba(255,120,40,0.35)");
  g.addColorStop(1, "rgba(255,80,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // star spikes
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3 + (Math.random() - 0.5) * 0.3);
    const sg = ctx.createLinearGradient(0, 0, 60, 0);
    sg.addColorStop(0, "rgba(255,230,170,0.9)");
    sg.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(60, 0);
    ctx.lineTo(0, 5);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
