// Third-person body for other players. createAvatar() gives the Blender character
// (modelAvatar.js) when its model is loaded, otherwise this file's fallback: a low-poly box
// soldier in the player's colour, holding the same gun as the first-person view-model. Animated from network state only (position, aim,
// velocity, crouch / grounded flags): walk + run cycle, crouch, jump pose, aim pitch.
//
// Proportions match the first-person player: eyes at 1.65 m standing and ~0.95 m crouched, body
// radius 0.35 m, so what you see is what later hit detection (MP4) will use.
import * as THREE from "three";
import { buildGun } from "./weapon.js";
import { FLAG } from "../net/snapshots.js";
import { getModel } from "../assets/models.js";
import { ModelAvatar } from "./modelAvatar.js";

/**
 * The body for a remote player: the Blender character in its outfit, or the box soldier if that
 * model isn't available (not exported yet, failed to load).
 * @param {string} color player colour
 * @param {string} [outfit] "corporate" | "engineer" (room.js OUTFITS)
 */
export function createAvatar(color, outfit = "corporate") {
  if (getModel(`player_${outfit}`)) {
    try {
      return new ModelAvatar(color, outfit);
    } catch (err) {
      console.warn("[avatar] model avatar failed, using the box soldier", err);
    }
  }
  return new BoxAvatar(color);
}

const THIGH = 0.44;
const SHIN = 0.48; // incl. boot
const HIP = 0.9; // standing hip height

export class BoxAvatar {
  /** @param {string} color css colour of the player */
  constructor(color) {
    const main = new THREE.Color(color);
    const darker = main.clone().lerp(new THREE.Color(0x24262c), 0.55);
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o });
    this.materials = {
      main: mat(main),
      dark: mat(darker),
      gear: mat(0x1c1e23, { roughness: 0.8 }),
      visor: mat(0x0b0c10, { roughness: 0.15, metalness: 0.6, emissive: main, emissiveIntensity: 0.35 }),
    };
    const M = this.materials;
    const box = (parent, w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    this.root = new THREE.Group();
    this.root.name = "avatar";
    this.root.rotation.order = "YXZ"; // yaw, then tip over around the body's own axis when dying

    // ---- hips (everything above the legs hangs off this, so crouching just lowers it)
    this.hips = new THREE.Group();
    this.hips.position.y = HIP;
    this.root.add(this.hips);
    box(this.hips, 0.36, 0.18, 0.24, M.dark, 0, 0, 0);

    // ---- legs: thigh pivot at the hip, shin pivot at the knee
    this.legs = [-1, 1].map((side) => {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.11, -0.04, 0);
      this.hips.add(thigh);
      box(thigh, 0.15, THIGH, 0.17, M.dark, 0, -THIGH / 2, 0);
      const shin = new THREE.Group();
      shin.position.y = -THIGH;
      thigh.add(shin);
      box(shin, 0.13, SHIN - 0.08, 0.15, M.dark, 0, -(SHIN - 0.08) / 2, 0);
      box(shin, 0.15, 0.1, 0.26, M.gear, 0, -SHIN + 0.05, -0.04); // boot
      return { thigh, shin, side };
    });

    // ---- torso (pivot at the waist), head, backpack
    this.torso = new THREE.Group();
    this.torso.position.y = 0.08;
    this.hips.add(this.torso);
    box(this.torso, 0.46, 0.56, 0.27, M.main, 0, 0.3, 0);
    box(this.torso, 0.48, 0.22, 0.3, M.gear, 0, 0.36, 0); // vest band
    box(this.torso, 0.32, 0.36, 0.14, M.gear, 0, 0.32, 0.2); // backpack

    this.head = new THREE.Group();
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    box(this.head, 0.24, 0.26, 0.26, M.dark, 0, 0.11, 0);
    box(this.head, 0.3, 0.14, 0.32, M.main, 0, 0.25, 0.01); // helmet
    box(this.head, 0.22, 0.07, 0.04, M.visor, 0, 0.13, -0.135); // visor

    // ---- arms + gun: one rig that pitches with the aim, pivot at the chest
    this.aim = new THREE.Group();
    this.aim.position.set(0, 0.46, 0);
    this.torso.add(this.aim);
    const gun = buildGun();
    gun.root.position.set(0.1, -0.06, -0.3);
    gun.root.traverse((o) => o.isMesh && (o.castShadow = true));
    this.aim.add(gun.root);
    this.muzzle = new THREE.Object3D(); // where remote tracers will start (MP4)
    this.muzzle.position.copy(gun.muzzle);
    gun.root.add(this.muzzle);
    // right arm: shoulder -> grip, left arm: shoulder -> handguard
    this._arm(M, 0.24, 0.02, 0.0, 0.11, -0.13, -0.2);
    this._arm(M, -0.24, 0.02, 0.0, 0.06, -0.07, -0.52);

    this.phase = 0;
    this.dead = false;
    this.deadT = 0; // seconds since death (collapse animation)
    this.crouch = 0; // 0 standing .. 1 crouched (smoothed)
    this.air = 0; // 0 grounded .. 1 airborne (smoothed)
  }

  /** an arm as one box from (sx,sy,sz) to (hx,hy,hz) in aim-rig space, with a glove at the end */
  _arm(M, sx, sy, sz, hx, hy, hz) {
    const a = new THREE.Vector3(sx, sy, sz), b = new THREE.Vector3(hx, hy, hz);
    const len = a.distanceTo(b);
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), M.main);
    g.position.copy(a).add(b).multiplyScalar(0.5);
    g.lookAt(b); // not parented yet, so this is in rig space: +Z (the box's length) points at the hand
    g.castShadow = true;
    this.aim.add(g);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), M.gear);
    glove.position.copy(b);
    this.aim.add(glove);
  }

  /**
   * @param {number} dt seconds
   * @param {{x:number,y:number,z:number,yaw:number,pitch:number,vx:number,vz:number,f:number}} s
   */
  update(dt, s) {
    if (this.dead) {
      // collapse backwards, then sink into the paper and disappear until the respawn
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.55);
      const ease = 1 - Math.pow(1 - k, 3);
      this.root.rotation.x = ease * 1.45;
      this.root.position.y = this._deadY - Math.max(0, this.deadT - 2) * 0.6;
      this.hips.position.y = HIP - ease * 0.55;
      for (const leg of this.legs) {
        leg.thigh.rotation.x = ease * 1.2;
        leg.shin.rotation.x = -ease * 1.4;
      }
      this.root.visible = this.deadT < 3;
      return;
    }
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;

    const speed = Math.hypot(s.vx, s.vz);
    const grounded = (s.f & FLAG.grounded) !== 0 || (s.f & FLAG.fly) !== 0;
    const k = Math.min(1, dt * 12);
    this.crouch += ((s.f & FLAG.crouch ? 1 : 0) - this.crouch) * k;
    this.air += ((grounded ? 0 : 1) - this.air) * Math.min(1, dt * 10);

    // walk cycle: one full cycle = two steps (~4 m walking, longer strides when sprinting)
    const stride = speed > 8 ? 5.2 : 4;
    if (grounded) this.phase += (speed / stride) * Math.PI * 2 * dt;
    const swing = Math.min(1, speed / 6.5) * (speed > 8 ? 0.75 : 0.55) * (1 - this.crouch * 0.6);

    const c = this.crouch, air = this.air;
    for (const leg of this.legs) {
      const ph = this.phase + (leg.side > 0 ? Math.PI : 0);
      const walkThigh = Math.sin(ph) * swing;
      const walkShin = -Math.max(0, Math.sin(ph + Math.PI / 2)) * swing * 1.3;
      let thigh = walkThigh * (1 - c) + 1.3 * c + walkThigh * 0.4 * c;
      let shin = walkShin * (1 - c) - 2.2 * c;
      // in the air: knees up a little
      thigh = thigh * (1 - air) + (leg.side > 0 ? 0.6 : 0.3) * air;
      shin = shin * (1 - air) - 0.9 * air;
      leg.thigh.rotation.x = thigh;
      leg.shin.rotation.x = shin;
    }
    // hip height follows the leg pose (crouch) + a little bob while running
    const legH = (a, b) => THIGH * Math.cos(a) + SHIN * Math.cos(a + b);
    const standH = HIP, crouchH = Math.max(0.3, legH(1.3, -2.2));
    const bob = grounded ? Math.abs(Math.sin(this.phase)) * 0.04 * Math.min(1, speed / 6.5) : 0;
    this.hips.position.y = standH + (crouchH - standH) * c + bob - air * 0.05;

    // lean forward when crouching / sprinting, aim follows pitch
    const pitch = s.pitch;
    this.torso.rotation.x = -0.7 * c - (speed > 8 ? 0.15 : 0) + pitch * 0.2;
    this.aim.rotation.x = pitch * 0.8 + 0.7 * c + (speed > 8 ? 0.15 : 0);
    this.head.rotation.x = pitch * 0.6 + 0.7 * c * 0.8;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this._deadY = this.root.position.y;
  }

  revive() {
    this.dead = false;
    this.root.rotation.x = 0;
    this.root.visible = true;
  }

  /** world position for the name tag (above the helmet) */
  tagAnchor(out = new THREE.Vector3()) {
    return out.set(0, 0.42, 0).applyMatrix4(this.head.matrixWorld);
  }

  /** world-space points used for line-of-sight tests: head and chest */
  sightPoints(out = [new THREE.Vector3(), new THREE.Vector3()]) {
    out[0].set(0, 0.12, 0).applyMatrix4(this.head.matrixWorld);
    out[1].set(0, 0.3, 0).applyMatrix4(this.torso.matrixWorld);
    return out;
  }

  dispose() {
    this.root.removeFromParent();
    const mats = new Set(Object.values(this.materials));
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      mats.add(o.material);
    });
    for (const m of mats) m.dispose();
  }
}
