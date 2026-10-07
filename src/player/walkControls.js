// M3 stand-in for the real player controller (M4): pointer-lock mouse look + WASD walking at
// eye height, no collisions yet. Q / E move up / down for inspecting the map.
import * as THREE from "three";

export class WalkControls {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom
   * @param {typeof import("../config.js").config} cfg
   */
  constructor(camera, dom, cfg) {
    this.camera = camera;
    this.dom = dom;
    this.cfg = cfg;
    this.enabled = false;
    this.euler = new THREE.Euler(0, 0, 0, "YXZ");
    this.keys = new Set();
    this.locked = false;

    this.onMouseMove = (e) => {
      if (!this.locked || !this.enabled) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * cfg.mouseSensitivity;
      this.euler.x -= e.movementY * cfg.mouseSensitivity;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      this.camera.quaternion.setFromEuler(this.euler);
    };
    this.onKeyDown = (e) => this.keys.add(e.code);
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChanged?.(this.locked);
    };
    this.onClick = () => {
      if (this.enabled && !this.locked) this.dom.requestPointerLock?.();
    };

    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    dom.addEventListener("click", this.onClick);
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? this.cfg.sprintSpeed : this.cfg.walkSpeed;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const side = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const vert = (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0);

    this.euler.setFromQuaternion(this.camera.quaternion);
    const yaw = this.euler.y;
    const dirX = -Math.sin(yaw) * fwd + Math.cos(yaw) * side;
    const dirZ = -Math.cos(yaw) * fwd - Math.sin(yaw) * side;
    const len = Math.hypot(dirX, dirZ) || 1;
    this.camera.position.x += (dirX / len) * speed * dt;
    this.camera.position.z += (dirZ / len) * speed * dt;
    this.camera.position.y = Math.max(0.3, this.camera.position.y + vert * speed * dt);
  }

  dispose() {
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.dom.removeEventListener("click", this.onClick);
  }
}
