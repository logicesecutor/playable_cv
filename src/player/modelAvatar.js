// Third-person body made in Blender (public/models/player_<outfit>.glb): the chibi job hunter.
// Same API as the old box soldier (avatar.js), driven by the same network state.
//
// Animation: the clips made in Blender (blender_src/scripts/build_anims.py) on an AnimationMixer.
//   body clips (Hips, Spine, Head, legs): Idle, Walk, Run, Crouch, CrouchWalk, Jump, Death
//     one at a time, cross-faded; Walk / Run / CrouchWalk play faster or slower with the speed
//   gun clips (Weapon bone only): Fire (each remote shot), Reload (FLAG.reload)
//   procedural on top: aim pitch (the Aim bone cancels the torso lean, so the gun points where
//     they aim), head pitch, the mittens following the gun's grips (the left one goes for the
//     cartridge during a reload), the cartridge dropping out, sinking away after a death
// The glTF exporter writes every bone into every clip, so the tracks are filtered per clip kind.
//
// Rig: every bone's rest rotation is the identity, and inside its wrapper the model faces +Z, so a
// "pitch" is a plain rotation.x (forward lean = +x, looking up = -x).
import * as THREE from "three";
import { instantiate } from "../assets/models.js";
import { createGun } from "./gunModel.js";
import { FLAG } from "../net/snapshots.js";

const BODY_BONES = ["Hips", "Spine", "Head", "Thigh.L", "Shin.L", "Foot.L", "Thigh.R", "Shin.R", "Foot.R"];
const GUN_BONES = ["Weapon"];
const LOOPS = new Set(["Idle", "Walk", "Run", "Crouch", "CrouchWalk", "Jump"]);
/** ground speed each moving clip was animated for (build_anims.SPEEDS) */
const CLIP_SPEED = { Walk: 6.5, Run: 11, CrouchWalk: 3 };
const RELOAD_TIME = 1.3; // the Reload clip's length (= config.weapon.reloadTime)

/** mitten centre relative to the gun's grip points (a mitten is ~0.17 m: it wraps the grip) */
const HAND_R_OFF = new THREE.Vector3(-0.035, -0.02, 0);
const HAND_L_OFF = new THREE.Vector3(0.03, -0.045, 0);
/** where the mittens flop to when the body goes down (Aim space) */
const DEAD_R = new THREE.Vector3(-0.42, -0.3, 0.05);
const DEAD_L = new THREE.Vector3(0.44, -0.22, 0.12);

const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const smooth = (t) => ((t = Math.min(1, Math.max(0, t))), t * t * (3 - 2 * t));

/** the model's clips, renamed ("Rig_x|Walk" -> "Walk") and filtered to their bones; cached per file */
const clipCache = new WeakMap();
function prepareClips(animations) {
  let out = clipCache.get(animations);
  if (out) return out;
  out = {};
  const body = new Set(BODY_BONES.map(sanitize)), gun = new Set(GUN_BONES.map(sanitize));
  for (const clip of animations) {
    const name = clip.name.split("|").pop();
    const keep = name === "Fire" || name === "Reload" ? gun : body;
    const tracks = clip.tracks.filter((t) => keep.has(t.name.split(".")[0]));
    out[name] = new THREE.AnimationClip(name, clip.duration, tracks);
  }
  clipCache.set(animations, out);
  return out;
}

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
    this.root.rotation.order = "YXZ";
    this.root.add(inst.root);

    // GLTFLoader sanitises node names ("Hand.R" -> "HandR"), so look them up the same way
    const n = (name) => {
      const o = inst.nodes[sanitize(name)];
      if (!o) throw new Error(`player_${outfit}: no bone ${name}`);
      return o;
    };
    this.b = {
      hips: n("Hips"), spine: n("Spine"), head: n("Head"), aim: n("Aim"), weapon: n("Weapon"),
      handR: n("Hand.R"), handL: n("Hand.L"),
    };
    this.head = this.b.head; // tag anchor / line of sight
    this.torso = this.b.spine;

    // the typewriter blaster on the Weapon bone (it faces -Z, the rig +Z)
    const gun = createGun({ accent: color });
    gun.root.rotation.y = Math.PI;
    gun.root.traverse((o) => o.isMesh && (o.castShadow = true));
    this.b.weapon.add(gun.root);
    gun.root.updateMatrix();
    this.gun = gun;
    this.magRest = gun.magazine ? gun.magazine.position.clone() : null;
    this.muzzle = new THREE.Object3D(); // where remote tracers start
    this.muzzle.position.copy(gun.muzzle);
    gun.root.add(this.muzzle);

    // animation
    this.clips = prepareClips(inst.animations);
    if (!this.clips.Idle) throw new Error(`player_${outfit}: no animation clips`);
    this.mixer = new THREE.AnimationMixer(inst.model);
    this.actions = {};
    for (const [name, clip] of Object.entries(this.clips)) {
      const a = this.mixer.clipAction(clip);
      if (!LOOPS.has(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = name === "Death";
      }
      this.actions[name] = a;
    }
    this.base = null; // current body clip
    this.forced = null; // model viewer: play this clip whatever the state
    this.setBase("Idle", 0);

    this.dead = false;
    this.deadT = 0;
    this.crouch = 0; // 0 standing .. 1 crouched (smoothed; the hitbox follows it too)
    this.air = 0; // 0 grounded .. 1 airborne (smoothed)
    this.reloadT = -1; // seconds into a reload, -1 = not reloading
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  /** cross-fade the body to another clip */
  setBase(name, fade = 0.15) {
    if (this.base === name || !this.actions[name]) return;
    const next = this.actions[name].reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    const prev = this.base && this.actions[this.base];
    if (prev && fade > 0) next.crossFadeFrom(prev, fade, false);
    else if (prev) prev.stop();
    this.base = name;
  }

  /**
   * @param {number} dt seconds
   * @param {{x:number,y:number,z:number,yaw:number,pitch:number,vx:number,vz:number,f:number}} s
   */
  update(dt, s) {
    const B = this.b;
    if (this.dead) {
      // the Death clip slumps the body; after 2 s it sinks into the paper and disappears
      this.deadT += dt;
      this.mixer.update(dt);
      this.root.position.y = this._deadY - Math.max(0, this.deadT - 2) * 0.6;
      // ragdoll-ish: the gun falls onto the chest, the mittens flop to the sides
      const k = Math.min(1, this.deadT / 0.5), e = 1 - (1 - k) ** 3;
      B.aim.rotation.set(1.3 * e, 0, 0.25 * e);
      this.placeHands(0);
      B.handR.position.lerp(DEAD_R, e);
      B.handL.position.lerp(DEAD_L, e);
      this.root.visible = this.deadT < 3;
      return;
    }
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;

    const speed = Math.hypot(s.vx, s.vz);
    const grounded = (s.f & FLAG.grounded) !== 0 || (s.f & FLAG.fly) !== 0;
    this.crouch += ((s.f & FLAG.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    this.air += ((grounded ? 0 : 1) - this.air) * Math.min(1, dt * 10);

    // body clip from the state
    let base;
    if (this.forced) base = this.forced;
    else if (this.air > 0.5) base = "Jump";
    else if (this.crouch > 0.5) base = speed > 0.6 ? "CrouchWalk" : "Crouch";
    else base = speed > 8.6 ? "Run" : speed > 0.6 ? "Walk" : "Idle";
    this.setBase(base, base === "Jump" ? 0.1 : 0.18);
    const a = this.actions[base];
    if (CLIP_SPEED[base]) a.setEffectiveTimeScale(Math.max(0.45, Math.min(1.8, speed / CLIP_SPEED[base])));

    // reload (other players: FLAG.reload; the clip runs once per reload)
    const reloading = (s.f & FLAG.reload) !== 0;
    if (reloading && this.reloadT < 0) {
      this.reloadT = 0;
      this.actions.Reload?.reset().play();
    } else if (!reloading && this.reloadT >= RELOAD_TIME) this.reloadT = -1;
    if (this.reloadT >= 0) this.reloadT += dt;

    this.mixer.update(dt);

    // aim: the Aim bone cancels the clip's torso lean, so the gun points where they aim
    const lean = B.spine.rotation.x;
    B.aim.rotation.set(-s.pitch * 0.9 - lean, 0, 0);
    B.head.rotation.x += -s.pitch * 0.6;

    // reload: the cartridge drops out under the rolled-over gun and the left hand fetches a new one
    const p = this.reloadT >= 0 ? Math.min(1, this.reloadT / RELOAD_TIME) : 1;
    const out = p < 0.35 ? smooth(p / 0.35) : p < 0.62 ? 1 : 1 - smooth((p - 0.62) / 0.2);
    const drop = Math.max(0, out);
    if (this.magRest) {
      const mag = this.gun.magazine;
      mag.position.copy(this.magRest);
      mag.position.y -= drop * 0.2;
      mag.visible = !(p > 0.4 && p < 0.55);
    }
    this.placeHands(drop);
  }

  /** mittens on the gun's grips (the gun moves with the Weapon bone's clips); `drop` 0..1 pulls the
   *  left hand down to the cartridge */
  placeHands(drop) {
    const B = this.b, g = this.gun;
    B.weapon.updateMatrix();
    this._m.multiplyMatrices(B.weapon.matrix, g.root.matrix); // gun space -> Aim space
    B.handR.position.copy(g.grips.r).applyMatrix4(this._m).add(HAND_R_OFF);
    B.handR.quaternion.copy(B.weapon.quaternion);
    B.handL.position.copy(g.grips.l).applyMatrix4(this._m).add(HAND_L_OFF);
    B.handL.quaternion.copy(B.weapon.quaternion);
    if (drop > 0) B.handL.position.y -= drop * 0.11;
  }

  /** a remote shot: kick the gun */
  fire() {
    if (this.dead || !this.actions.Fire) return;
    this.actions.Fire.reset().play();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this._deadY = this.root.position.y;
    this.actions.Reload?.stop();
    this.reloadT = -1;
    this.setBase("Death", 0.08);
  }

  revive() {
    this.dead = false;
    this.root.visible = true;
    this.root.rotation.x = 0;
    this.setBase("Idle", 0);
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
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.inst.model);
    this.root.removeFromParent();
    this.inst.dispose(); // the model's geometry + palette are shared between players: kept
    this.gun.dispose();
  }
}
