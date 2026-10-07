// Intro: the page seen flat from above (looks exactly like the PDF) -> letters rise out of the
// paper -> the camera swoops down to eye level at the spawn point. Click / Space skips it.
import * as THREE from "three";

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => {
  const c1 = 1.2, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const FLAT = 0.01; // letters' height scale while they are still "ink"

export class Intro {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {ReturnType<typeof import("./buildWorld.js").buildWorld>} world
   * @param {typeof import("../config.js").config} cfg
   */
  constructor(camera, world, cfg) {
    this.camera = camera;
    this.world = world;
    this.cfg = cfg;
    this.t = 0;
    this.done = false;

    const { W, D } = world.size;
    this.topFov = 45;
    this.center = new THREE.Vector3(W / 2, 0, D / 2);

    // end pose: at the spawn, eye height, looking up the page (-Z)
    this.endPos = new THREE.Vector3(world.spawn.x, cfg.player.eyeHeight, world.spawn.z);
    this.endQuat = new THREE.Quaternion(); // identity = looking down -Z

    world.letters.scale.y = FLAT;
    this.reset();
  }

  /** top-down pose that fits the whole page in view for the current aspect */
  topPose() {
    const { W, D } = this.world.size;
    const half = THREE.MathUtils.degToRad(this.topFov / 2);
    const aspect = this.camera.aspect;
    const h = Math.max(D / 2 / Math.tan(half), W / 2 / (Math.tan(half) * aspect)) * 1.06;
    const pos = new THREE.Vector3(this.center.x, h, this.center.z);
    const m = new THREE.Matrix4().lookAt(pos, this.center, new THREE.Vector3(0, 0, -1));
    const quat = new THREE.Quaternion().setFromRotationMatrix(m);
    return { pos, quat, h };
  }

  reset() {
    this.t = 0;
    this.done = false;
    this.world.letters.scale.y = FLAT;
    const top = this.topPose();
    this.startPos = top.pos;
    this.startQuat = top.quat;
    // swoop: come in low from behind the spawn point
    this.ctrl = new THREE.Vector3(
      (top.pos.x + this.endPos.x) / 2,
      top.h * 0.3,
      this.endPos.z + this.world.size.D * 0.25,
    );
    this.camera.fov = this.topFov;
    this.camera.position.copy(this.startPos);
    this.camera.quaternion.copy(this.startQuat);
    this.fitNear();
    this.camera.updateProjectionMatrix();
  }

  /**
   * High above the page the flat letters sit 1 cm over the printed ink. With the default near
   * plane (0.1 m) the depth buffer can't separate them at 300 m and they flicker; pushing the
   * near plane out in proportion to the height keeps the precision.
   */
  fitNear() {
    this.camera.near = THREE.MathUtils.clamp(this.camera.position.y * 0.04, 0.1, 20);
  }

  /** keep the page framed if the window is resized during the hold */
  onResize() {
    if (this.t < this.cfg.intro.flyStart) {
      const top = this.topPose();
      this.startPos = top.pos;
      this.startQuat = top.quat;
      this.camera.position.copy(top.pos);
    }
  }

  skip() {
    this.t = this.cfg.intro.flyStart + this.cfg.intro.fly;
  }

  /** @returns {boolean} true while running */
  update(dt) {
    if (this.done) return false;
    const I = this.cfg.intro;
    this.t += dt;

    // letters rise
    const r = clamp01((this.t - I.hold) / I.rise);
    this.world.letters.scale.y = FLAT + (1 - FLAT) * easeOutBack(r);

    // camera flight (quadratic bezier for position, slerp for rotation)
    const f = easeInOut(clamp01((this.t - I.flyStart) / I.fly));
    const a = this.startPos, b = this.ctrl, c = this.endPos;
    const u = 1 - f;
    this.camera.position.set(
      u * u * a.x + 2 * u * f * b.x + f * f * c.x,
      u * u * a.y + 2 * u * f * b.y + f * f * c.y,
      u * u * a.z + 2 * u * f * b.z + f * f * c.z,
    );
    this.camera.quaternion.slerpQuaternions(this.startQuat, this.endQuat, f);
    this.camera.fov = THREE.MathUtils.lerp(this.topFov, this.cfg.fov, f);
    this.fitNear();
    this.camera.updateProjectionMatrix();

    if (this.t >= I.flyStart + I.fly) {
      this.world.letters.scale.y = 1;
      this.camera.near = 0.1;
      this.camera.updateProjectionMatrix();
      this.done = true;
    }
    return !this.done;
  }
}
