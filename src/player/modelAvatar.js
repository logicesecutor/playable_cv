// Third-person body made in Blender (public/models/player_<outfit>.glb): the chibi job hunter.
// Same API as the old box soldier (avatar.js), driven by the same network state.
//
// Rig: every bone's rest rotation is the identity (they all point up in Blender), and inside its
// wrapper the model faces +Z. So a "pitch" here is a plain rotation.x, with the opposite sign of
// the old box soldier's (which faced -Z): forward lean / leg swing forward = negative x.
//
// Until the animation clips exist (Phase 3), the pose is procedural: walk / run cycle, crouch
// (deep squat, hips back, torso forward, a little squash so the head drops to the crouched
// hitbox), jump pose, aim pitch, and a death collapse. Hands hold the gun, which sits on the
// Weapon bone.
import * as THREE from "three";
import { instantiate } from "../assets/models.js";
import { createGun } from "./gunModel.js";
import { FLAG } from "../net/snapshots.js";

const THIGH = 0.24; // hip -> knee (rig)
const SHIN = 0.26; // knee -> ankle
const ANKLE = 0.1; // ankle height

// crouch pose (tuned in viewer.html so the head lands in the crouched head hitbox)
// (head centre within ~5 cm of the crouched head hitbox; the feet end up ~0.3 m behind centre)
const CROUCH = { thigh: 1.55, shin: -2.75, lean: 0.8, squash: 0.75, hipsBack: 0.3 };

/** where the gun sits, in Aim-bone space (model space: +Z forward, -X = the character's right) */
const GUN_AT = new THREE.Vector3(-0.08, -0.06, 0.34);
/** mitten centre relative to the gun's grip points (a mitten is ~0.17 m: it wraps the grip) */
const HAND_R_OFF = new THREE.Vector3(-0.035, -0.02, 0);
const HAND_L_OFF = new THREE.Vector3(0.03, -0.045, 0);

const legHeight = (a, b) => THIGH * Math.cos(a) + SHIN * Math.cos(a + b) + ANKLE;

export class ModelAvatar {
  /**
   * @param {string} color player colour (accent)
   * @param {string} outfit "corporate" | "engineer"
   */
  constructor(color, outfit) {
    const inst = instantiate(`player_${outfit}`, { accent: color });
    if (!inst) throw new Error(`model player_${outfit} not loaded`);
    this.inst = inst;
    this.outfit = outfit;
    this.root = new THREE.Group();
    this.root.name = "avatar";
    this.root.rotation.order = "YXZ"; // yaw, then tip over when dying
    this.root.add(inst.root);

    // GLTFLoader sanitises node names ("Hand.R" -> "HandR"), so look them up the same way
    const n = (name) => {
      const o = inst.nodes[THREE.PropertyBinding.sanitizeNodeName(name)];
      if (!o) throw new Error(`player_${outfit}: no bone ${name}`);
      return o;
    };
    this.b = {
      hips: n("Hips"), spine: n("Spine"), head: n("Head"), aim: n("Aim"), weapon: n("Weapon"),
      handR: n("Hand.R"), handL: n("Hand.L"),
      legs: ["R", "L"].map((s, i) => ({ thigh: n(`Thigh.${s}`), shin: n(`Shin.${s}`), foot: n(`Foot.${s}`), side: i ? 1 : -1 })),
    };
    this.head = this.b.head; // tag anchor / line of sight
    this.torso = this.b.spine;
    this.hipsRest = this.b.hips.position.clone();
    this.headRestY = this.b.head.position.y;

    // the typewriter blaster on the Weapon bone (it faces -Z, the rig +Z)
    const gun = createGun({ accent: color });
    gun.root.rotation.y = Math.PI;
    gun.root.traverse((o) => o.isMesh && (o.castShadow = true));
    this.b.weapon.position.copy(GUN_AT);
    this.b.weapon.rotation.set(0, 0, 0);
    this.b.weapon.add(gun.root);
    this.gun = gun;
    this.muzzle = new THREE.Object3D(); // where remote tracers start
    this.muzzle.position.copy(gun.muzzle);
    gun.root.add(this.muzzle);

    // hands on the gun's grips (hands and Weapon are both children of Aim, so: grip -> Aim space)
    const toAim = (p, off) => p.clone().applyMatrix4(gun.root.matrix).applyMatrix4(this.b.weapon.matrix).add(off);
    this.b.weapon.updateMatrix();
    gun.root.updateMatrix();
    this.b.handR.position.copy(toAim(gun.grips.r, HAND_R_OFF));
    this.b.handL.position.copy(toAim(gun.grips.l, HAND_L_OFF));
    this.b.handR.rotation.set(0.2, 0, -0.15);
    this.b.handL.rotation.set(-0.2, 0, 0.35);

    this.phase = 0;
    this.dead = false;
    this.deadT = 0;
    this.crouch = 0; // 0 standing .. 1 crouched (smoothed)
    this.air = 0; // 0 grounded .. 1 airborne (smoothed)
  }

  /**
   * @param {number} dt seconds
   * @param {{x:number,y:number,z:number,yaw:number,pitch:number,vx:number,vz:number,f:number}} s
   */
  update(dt, s) {
    const B = this.b;
    if (this.dead) {
      // collapse backwards, then sink into the paper and disappear until the respawn
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.55);
      const ease = 1 - Math.pow(1 - k, 3);
      this.root.rotation.x = ease * 1.45;
      this.root.position.y = this._deadY - Math.max(0, this.deadT - 2) * 0.6;
      B.hips.position.y = this.hipsRest.y - ease * 0.3;
      for (const leg of B.legs) {
        leg.thigh.rotation.x = -ease * 1.2;
        leg.shin.rotation.x = ease * 1.4;
      }
      B.head.rotation.x = ease * 0.5;
      this.root.visible = this.deadT < 3;
      return;
    }
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;

    const speed = Math.hypot(s.vx, s.vz);
    const grounded = (s.f & FLAG.grounded) !== 0 || (s.f & FLAG.fly) !== 0;
    this.crouch += ((s.f & FLAG.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    this.air += ((grounded ? 0 : 1) - this.air) * Math.min(1, dt * 10);
    const c = this.crouch, air = this.air, sprint = speed > 8 ? 1 : 0;

    // walk cycle: short chibi legs take quick steps (one cycle = two steps)
    const stride = sprint ? 3.4 : 2.7;
    if (grounded) this.phase += (speed / stride) * Math.PI * 2 * dt;
    const swing = Math.min(1, speed / 6.5) * (sprint ? 0.95 : 0.75) * (1 - c * 0.6);

    for (const leg of B.legs) {
      const ph = this.phase + (leg.side > 0 ? Math.PI : 0);
      const walkThigh = Math.sin(ph) * swing; // + = forward (box-soldier sign)
      const walkShin = -Math.max(0, Math.sin(ph + Math.PI / 2)) * swing * 1.5;
      let thigh = walkThigh * (1 - c) + CROUCH.thigh * c + walkThigh * 0.4 * c;
      let shin = walkShin * (1 - c) + CROUCH.shin * c;
      thigh = thigh * (1 - air) + (leg.side > 0 ? 0.75 : 0.35) * air; // knees up in the air
      shin = shin * (1 - air) - 1.0 * air;
      leg.thigh.rotation.x = -thigh;
      leg.shin.rotation.x = -shin;
      leg.foot.rotation.x = (thigh + shin) * 0.85; // keep the shoe roughly flat
    }

    // hips follow the legs (squat), sit back a little when crouched, bob while running
    const standH = legHeight(0, 0), crouchH = legHeight(CROUCH.thigh, CROUCH.shin);
    const bob = grounded ? Math.abs(Math.sin(this.phase)) * 0.05 * Math.min(1, speed / 6.5) : 0;
    B.hips.position.y = this.hipsRest.y + (crouchH - standH) * c + bob - air * 0.05;
    B.hips.position.z = this.hipsRest.z - CROUCH.hipsBack * c;

    // torso leans forward when crouching / sprinting; the neck tucks in when crouched
    const lean = CROUCH.lean * c + sprint * 0.18 - s.pitch * 0.15;
    B.spine.rotation.x = lean;
    B.head.position.y = this.headRestY * (1 - (1 - CROUCH.squash) * c);
    // the gun points where they aim, whatever the torso does; the head follows half-way
    B.aim.rotation.x = -s.pitch * 0.9 - lean;
    B.head.rotation.x = -s.pitch * 0.6 - lean * 0.85;
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
    this.b.head.rotation.x = 0;
  }

  /** world position for the name tag (above the hair / beanie) */
  tagAnchor(out = new THREE.Vector3()) {
    return out.set(0, 0.78, 0).applyMatrix4(this.head.matrixWorld);
  }

  /** world-space points used for line-of-sight tests: head and chest */
  sightPoints(out = [new THREE.Vector3(), new THREE.Vector3()]) {
    out[0].set(0, 0.3, 0).applyMatrix4(this.head.matrixWorld);
    out[1].set(0, 0.3, 0).applyMatrix4(this.torso.matrixWorld);
    return out;
  }

  dispose() {
    this.root.removeFromParent();
    this.inst.dispose(); // the model's geometry + palette are shared between players: kept
    this.gun.dispose();
  }
}
